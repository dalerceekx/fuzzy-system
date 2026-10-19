import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  MedicineStatus,
  ProtocolVersionStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import { isUniqueViolation } from '../prisma/db-errors.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type {
  CreateProtocolDto,
  ListProtocolsQueryDto,
  ProtocolDrugDto,
  UpdateProtocolVersionDto,
} from './dto/protocol.dto.js';
import {
  assertSameDemoScope,
  likeLiteral,
  lockActor,
  lockRow,
  lockRows,
  VET_APPROVER_ROLES,
  VET_EDITOR_ROLES,
} from './vet-db.js';
import { VetErrors } from './vet.errors.js';
import {
  toProtocolSummary,
  toVersionResponse,
  VERSION_INCLUDE,
  versionAuditValue,
  type ProtocolResponse,
  type ProtocolVersionResponse,
  type VersionRow,
} from './vet.presenter.js';

/**
 * The only protocol content a farmer may ever see: the APPROVED version,
 * and only while every one of its medicines is still APPROVED.
 */
export const FARMER_VISIBLE_VERSION = {
  status: ProtocolVersionStatus.APPROVED,
  drugs: { every: { medicine: { is: { status: MedicineStatus.APPROVED } } } },
} satisfies Prisma.ProtocolVersionWhereInput;

export const FARMER_VISIBLE_PROTOCOL = {
  archivedAt: null,
  isDemo: false,
  versions: { some: FARMER_VISIBLE_VERSION },
} satisfies Prisma.ProtocolWhereInput;

const PROTOCOL_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  code: (dir: Prisma.SortOrder) => ({ code: dir }),
};

type ProtocolWithVersions = Prisma.ProtocolGetPayload<object> & {
  versions: VersionRow[];
};

function isStaff(user: Pick<AuthUser, 'role'>): boolean {
  return user.role !== UserRole.FARMER;
}

function assertDrugsPresent(isEmergency: boolean, drugCount: number): void {
  if (!isEmergency && drugCount === 0) throw VetErrors.drugsRequired();
}

function drugRows(versionId: string, drugs: readonly ProtocolDrugDto[]) {
  return drugs.map((drug, index) => ({
    protocolVersionId: versionId,
    medicineId: drug.medicineId,
    dosePerKg: new Prisma.Decimal(drug.dosePerKg),
    doseUnit: drug.doseUnit,
    maxSingleDose:
      drug.maxSingleDose === undefined
        ? null
        : new Prisma.Decimal(drug.maxSingleDose),
    route: drug.route,
    frequencyPerDay: drug.frequencyPerDay,
    durationDays: drug.durationDays,
    sortOrder: index,
  }));
}

@Injectable()
export class ProtocolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: ListProtocolsQueryDto,
  ): Promise<Paginated<ProtocolResponse>> {
    const staff = isStaff(user);
    const where: Prisma.ProtocolWhereInput = {
      AND: [
        staff ? {} : FARMER_VISIBLE_PROTOCOL,
        query.species ? { species: query.species } : {},
        query.q
          ? { code: { contains: likeLiteral(query.q), mode: 'insensitive' } }
          : {},
      ],
    };
    const orderBy = [
      ...buildOrderBy(query.sort, PROTOCOL_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.ProtocolOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.protocol.findMany({
        where,
        orderBy,
        include: { versions: this.versionsQuery(staff, 'list') },
        ...toSkipTake(query),
      }),
      this.prisma.protocol.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toResponse(row, staff)),
      total,
      query,
    );
  }

  async get(user: AuthUser, id: string): Promise<ProtocolResponse> {
    const staff = isStaff(user);
    const protocol = await this.prisma.protocol.findFirst({
      where: { id, ...(staff ? {} : FARMER_VISIBLE_PROTOCOL) },
      include: { versions: this.versionsQuery(staff) },
    });
    if (!protocol) throw Errors.notFound();
    return this.toResponse(protocol, staff);
  }

  async getVersion(
    user: AuthUser,
    protocolId: string,
    versionId: string,
  ): Promise<ProtocolVersionResponse> {
    const staff = isStaff(user);
    const version = await this.prisma.protocolVersion.findFirst({
      where: staff
        ? { id: versionId, protocolId }
        : {
            id: versionId,
            protocolId,
            ...FARMER_VISIBLE_VERSION,
            protocol: { is: { archivedAt: null, isDemo: false } },
          },
      include: VERSION_INCLUDE,
    });
    if (!version) throw Errors.notFound();
    return toVersionResponse(version, staff);
  }

  // -------------------------------------------------------------------------
  // Mutations (VET, ADMIN, SUPER_ADMIN; approval VET only)
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateProtocolDto,
  ): Promise<ProtocolResponse> {
    const content = dto.version;
    assertDrugsPresent(content.isEmergency, content.drugs.length);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
        if (await tx.protocol.findUnique({ where: { code: dto.code } })) {
          throw VetErrors.protocolCodeTaken();
        }
        await this.assertUsableMedicines(tx, content.drugs, actor.isDemo);
        const protocol = await tx.protocol.create({
          data: {
            code: dto.code,
            species: dto.species,
            // Demo accounts only ever produce demo (never approvable) data.
            isDemo: actor.isDemo,
            createdById: actor.id,
          },
        });
        const { id: versionId } = await tx.protocolVersion.create({
          data: {
            protocolId: protocol.id,
            version: 1,
            title: content.title,
            condition: content.condition,
            isEmergency: content.isEmergency,
            instructions: content.instructions,
            createdById: actor.id,
          },
        });
        await tx.protocolDrug.createMany({
          data: drugRows(versionId, content.drugs),
        });
        const version = await this.loadVersion(tx, versionId);
        await this.audit.record(
          {
            action: AuditAction.PROTOCOL_CREATED,
            resourceType: 'protocol',
            resourceId: protocol.id,
            newValue: {
              protocolCode: protocol.code,
              species: protocol.species,
              isDemo: protocol.isDemo,
              versionId,
              ...versionAuditValue(version),
            },
          },
          tx,
        );
        return this.toResponse({ ...protocol, versions: [version] }, true);
      });
    } catch (err) {
      // Two concurrent creates with the same code: the unique index decides.
      if (isUniqueViolation(err)) throw VetErrors.protocolCodeTaken();
      throw err;
    }
  }

  updateVersion(
    user: AuthUser,
    protocolId: string,
    versionId: string,
    dto: UpdateProtocolVersionDto,
  ): Promise<ProtocolVersionResponse> {
    const fields = {
      title: dto.title,
      condition: dto.condition,
      isEmergency: dto.isEmergency,
      instructions: dto.instructions,
    };
    if (
      dto.drugs === undefined &&
      Object.values(fields).every((value) => value === undefined)
    ) {
      throw VetErrors.emptyUpdate();
    }
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      const before = await this.lockVersion(tx, protocolId, versionId);
      assertSameDemoScope(actor, before.protocol.isDemo);
      // Approved (and superseded/archived) content is immutable: a change
      // means a new version that a VET approves again.
      if (before.status !== ProtocolVersionStatus.DRAFT) {
        throw VetErrors.protocolImmutable();
      }
      if (before.protocol.archivedAt) throw VetErrors.protocolArchived();
      assertDrugsPresent(
        dto.isEmergency ?? before.isEmergency,
        dto.drugs?.length ?? before.drugs.length,
      );
      if (dto.drugs) {
        await this.assertUsableMedicines(tx, dto.drugs, before.protocol.isDemo);
        await tx.protocolDrug.deleteMany({
          where: { protocolVersionId: versionId },
        });
        await tx.protocolDrug.createMany({
          data: drugRows(versionId, dto.drugs),
        });
      }
      await tx.protocolVersion.update({
        where: { id: versionId },
        data: fields,
      });
      const after = await this.loadVersion(tx, versionId);
      await this.audit.record(
        {
          action: AuditAction.PROTOCOL_VERSION_UPDATED,
          resourceType: 'protocol_version',
          resourceId: versionId,
          oldValue: versionAuditValue(before),
          newValue: versionAuditValue(after),
        },
        tx,
      );
      return toVersionResponse(after, true);
    });
  }

  /**
   * New DRAFT copied from the APPROVED version (or the latest one). The
   * protocol row lock serializes this with approvals and other new drafts.
   */
  createVersion(
    user: AuthUser,
    protocolId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      if (!(await lockRow(tx, 'protocols', protocolId))) {
        throw Errors.notFound();
      }
      const protocol = await tx.protocol.findUniqueOrThrow({
        where: { id: protocolId },
        include: {
          versions: { include: VERSION_INCLUDE, orderBy: { version: 'desc' } },
        },
      });
      assertSameDemoScope(actor, protocol.isDemo);
      if (protocol.archivedAt) throw VetErrors.protocolArchived();
      if (
        protocol.versions.some((v) => v.status === ProtocolVersionStatus.DRAFT)
      ) {
        throw VetErrors.draftExists();
      }
      const source =
        protocol.versions.find(
          (v) => v.status === ProtocolVersionStatus.APPROVED,
        ) ?? protocol.versions[0];
      const created = await tx.protocolVersion.create({
        data: {
          protocolId,
          version: (protocol.versions[0]?.version ?? 0) + 1,
          title: source.title,
          condition: source.condition,
          isEmergency: source.isEmergency,
          instructions: source.instructions,
          createdById: actor.id,
        },
      });
      await tx.protocolDrug.createMany({
        data: source.drugs.map((drug) => ({
          protocolVersionId: created.id,
          medicineId: drug.medicineId,
          dosePerKg: drug.dosePerKg,
          doseUnit: drug.doseUnit,
          maxSingleDose: drug.maxSingleDose,
          route: drug.route,
          frequencyPerDay: drug.frequencyPerDay,
          durationDays: drug.durationDays,
          sortOrder: drug.sortOrder,
        })),
      });
      const version = await this.loadVersion(tx, created.id);
      await this.audit.record(
        {
          action: AuditAction.PROTOCOL_VERSION_CREATED,
          resourceType: 'protocol_version',
          resourceId: version.id,
          newValue: {
            protocolId,
            copiedFromVersionId: source.id,
            ...versionAuditValue(version),
          },
        },
        tx,
      );
      return toVersionResponse(version, true);
    });
  }

  /**
   * VET only. In one transaction: the protocol row is locked (serializing
   * concurrent approvals), the version's medicines are share-locked (so
   * none can be archived mid-approval), the current APPROVED version
   * becomes SUPERSEDED and this one APPROVED. The database re-checks that
   * the approver's current role is VET and that demo protocols stay
   * unapproved.
   */
  approveVersion(
    user: AuthUser,
    protocolId: string,
    versionId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_APPROVER_ROLES);
      if (!(await lockRow(tx, 'protocols', protocolId))) {
        throw Errors.notFound();
      }
      const before = await this.lockVersion(tx, protocolId, versionId);
      if (before.status !== ProtocolVersionStatus.DRAFT) {
        throw VetErrors.versionNotDraft();
      }
      // Demo data is never validated, and demo accounts validate nothing.
      if (before.protocol.isDemo || actor.isDemo) {
        throw VetErrors.demoNotApprovable();
      }
      if (before.protocol.archivedAt) throw VetErrors.protocolArchived();
      assertDrugsPresent(before.isEmergency, before.drugs.length);

      const medicineIds = before.drugs.map((drug) => drug.medicineId);
      await lockRows(tx, 'medicines', medicineIds, 'SHARE');
      const notApproved = await tx.medicine.findMany({
        where: {
          id: { in: medicineIds },
          NOT: { status: MedicineStatus.APPROVED },
        },
        select: { id: true },
      });
      if (notApproved.length > 0) {
        throw VetErrors.medicineNotApproved(notApproved.map((m) => m.id));
      }

      const previous = await tx.protocolVersion.findFirst({
        where: { protocolId, status: ProtocolVersionStatus.APPROVED },
        select: { id: true, version: true },
      });
      if (previous) {
        await tx.protocolVersion.update({
          where: { id: previous.id },
          data: { status: ProtocolVersionStatus.SUPERSEDED },
        });
      }
      await tx.protocolVersion.update({
        where: { id: versionId },
        data: {
          status: ProtocolVersionStatus.APPROVED,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
      });
      const after = await this.loadVersion(tx, versionId);
      await this.audit.record(
        {
          action: AuditAction.PROTOCOL_VERSION_APPROVED,
          resourceType: 'protocol_version',
          resourceId: versionId,
          oldValue: {
            status: before.status,
            supersededVersionId: previous?.id ?? null,
            supersededVersion: previous?.version ?? null,
          },
          newValue: {
            protocolId,
            protocolCode: before.protocol.code,
            ...versionAuditValue(after),
          },
        },
        tx,
      );
      return toVersionResponse(after, true);
    });
  }

  archiveVersion(
    user: AuthUser,
    protocolId: string,
    versionId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      const before = await this.lockVersion(tx, protocolId, versionId);
      assertSameDemoScope(actor, before.protocol.isDemo);
      if (before.status === ProtocolVersionStatus.ARCHIVED) {
        throw VetErrors.versionArchived();
      }
      await tx.protocolVersion.update({
        where: { id: versionId },
        data: { status: ProtocolVersionStatus.ARCHIVED },
      });
      const after = await this.loadVersion(tx, versionId);
      await this.audit.record(
        {
          action: AuditAction.PROTOCOL_VERSION_ARCHIVED,
          resourceType: 'protocol_version',
          resourceId: versionId,
          oldValue: { protocolId, status: before.status },
          newValue: { protocolId, status: after.status },
        },
        tx,
      );
      return toVersionResponse(after, true);
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Staff lists embed only the current APPROVED and DRAFT versions (at most
   * one of each, enforced by partial unique indexes), so page size stays
   * bounded; the full history is served by GET /vet/protocols/:id.
   */
  private versionsQuery(staff: boolean, view: 'list' | 'detail' = 'detail') {
    return staff
      ? {
          ...(view === 'list'
            ? {
                where: {
                  status: {
                    in: [
                      ProtocolVersionStatus.APPROVED,
                      ProtocolVersionStatus.DRAFT,
                    ],
                  },
                },
              }
            : {}),
          include: VERSION_INCLUDE,
          orderBy: { version: 'desc' as const },
        }
      : {
          where: FARMER_VISIBLE_VERSION,
          include: VERSION_INCLUDE,
          take: 1,
        };
  }

  private toResponse(
    protocol: ProtocolWithVersions,
    staff: boolean,
  ): ProtocolResponse {
    const approved = protocol.versions.find(
      (v) => v.status === ProtocolVersionStatus.APPROVED,
    );
    return {
      ...toProtocolSummary(protocol),
      approvedVersion: approved ? toVersionResponse(approved, staff) : null,
      ...(staff
        ? { versions: protocol.versions.map((v) => toVersionResponse(v, true)) }
        : {}),
    };
  }

  private loadVersion(tx: Tx, id: string): Promise<VersionRow> {
    return tx.protocolVersion.findUniqueOrThrow({
      where: { id },
      include: VERSION_INCLUDE,
    });
  }

  /** Locks the version row (FOR UPDATE); 404 unless it belongs to protocolId. */
  private async lockVersion(tx: Tx, protocolId: string, versionId: string) {
    if (!(await lockRow(tx, 'protocol_versions', versionId))) {
      throw Errors.notFound();
    }
    const version = await tx.protocolVersion.findFirst({
      where: { id: versionId, protocolId },
      include: { ...VERSION_INCLUDE, protocol: true },
    });
    if (!version) throw Errors.notFound();
    return version;
  }

  /**
   * Drug medicines must be distinct, exist, not be archived and share the
   * protocol's demo scope (a real protocol never references demo medicines).
   */
  private async assertUsableMedicines(
    tx: Tx,
    drugs: readonly ProtocolDrugDto[],
    isDemo: boolean,
  ): Promise<void> {
    const ids = drugs.map((drug) => drug.medicineId);
    if (new Set(ids).size !== ids.length) throw VetErrors.duplicateMedicine();
    if (ids.length === 0) return;
    const usable = await tx.medicine.findMany({
      where: {
        id: { in: ids },
        isDemo,
        NOT: { status: MedicineStatus.ARCHIVED },
      },
      select: { id: true },
    });
    const found = new Set(usable.map((m) => m.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) throw VetErrors.medicineUnavailable(missing);
  }
}
