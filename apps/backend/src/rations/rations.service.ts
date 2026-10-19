import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { truncate } from '../common/strings.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { RationProfile } from '../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import {
  RATION_NAME_MAX,
  type CopyRationDto,
  type CreateRationDto,
  type ListRationsQueryDto,
  type RationItemDto,
  type UpdateRationDto,
} from './dto/ration.dto.js';
import {
  findParameterViolation,
  type RationParameters,
} from './ration-profiles.js';
import {
  lastIssuesOf,
  lockActiveFarm,
  lockAnimalType,
  lockOwnedRation,
  lockUsableFeedItems,
} from './rations-db.js';
import { RationErrors } from './rations.errors.js';
import {
  RATION_INCLUDE,
  rationAuditValue,
  toRationResponse,
  type RationResponse,
  type RationRow,
} from './rations.presenter.js';

const RATION_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  name: (dir: Prisma.SortOrder) => ({ name: dir }),
  updatedAt: (dir: Prisma.SortOrder) => ({ updatedAt: dir }),
};

const COPY_SUFFIX = ' (nusxa)';

/** Ownership is always part of the query: other farmers' rations are 404. */
const owned = (ownerId: string, id: string): Prisma.RationWhereInput => ({
  id,
  farm: { ownerId },
});

/** 400 RATION_ITEM_DUPLICATE before anything is read or locked. */
function assertNoDuplicateItems(items: readonly RationItemDto[]): void {
  const seen = new Set<string>();
  for (const { inventoryItemId } of items) {
    if (seen.has(inventoryItemId)) {
      throw RationErrors.itemDuplicate(inventoryItemId);
    }
    seen.add(inventoryItemId);
  }
}

function assertParameters(
  profile: RationProfile,
  params: RationParameters,
): void {
  const field = findParameterViolation(profile, params);
  if (field) throw RationErrors.parameterInvalid(field);
}

/** Item lines in the client's order (position = index). */
function itemRows(rationId: string, items: readonly RationItemDto[]) {
  return items.map((item, position) => ({
    rationId,
    inventoryItemId: item.inventoryItemId,
    dailyPerAnimal: item.dailyPerAnimal,
    position,
  }));
}

/** Empty notes are stored as "no notes". */
const notesValue = (notes: string | null | undefined) =>
  notes === undefined ? undefined : notes || null;

@Injectable()
export class RationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ownerId: string,
    query: ListRationsQueryDto,
  ): Promise<Paginated<RationResponse>> {
    const where: Prisma.RationWhereInput = {
      farm: { ownerId },
      ...(query.farmId ? { farmId: query.farmId } : {}),
      ...(query.animalTypeId ? { animalTypeId: query.animalTypeId } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, RATION_ORDER_BY, { updatedAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.RationOrderByWithRelationInput[];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ration.findMany({
        where,
        orderBy,
        include: RATION_INCLUDE,
        ...toSkipTake(query),
      }),
      this.prisma.ration.count({ where }),
    ]);
    return paginated(await this.present(this.prisma, rows), total, query);
  }

  /** Archived rations too (history). */
  async get(ownerId: string, id: string): Promise<RationResponse> {
    const row = await this.prisma.ration.findFirst({
      where: owned(ownerId, id),
      include: RATION_INCLUDE,
    });
    if (!row) throw Errors.notFound();
    const [response] = await this.present(this.prisma, [row]);
    return response;
  }

  /** Saving a ration never changes stock: only an issue does. */
  async create(ownerId: string, dto: CreateRationDto): Promise<RationResponse> {
    assertNoDuplicateItems(dto.items);
    return this.prisma.$transaction(async (tx) => {
      const farmId = await lockActiveFarm(tx, ownerId, dto.farmId);
      const type = await lockAnimalType(tx, farmId, dto.animalTypeId);
      assertParameters(type.profile, {
        purpose: dto.purpose,
        physiologicalState: dto.physiologicalState ?? null,
        milkYieldLiters: dto.milkYieldLiters ?? null,
      });
      await this.assertUsableItems(tx, farmId, dto.items);

      const { id } = await tx.ration.create({
        data: {
          farmId,
          animalTypeId: type.id,
          name: dto.name,
          animalCount: dto.animalCount,
          averageWeightKg: dto.averageWeightKg ?? null,
          ageMonths: dto.ageMonths ?? null,
          purpose: dto.purpose,
          physiologicalState: dto.physiologicalState ?? null,
          milkYieldLiters: dto.milkYieldLiters ?? null,
          days: dto.days,
          notes: notesValue(dto.notes) ?? null,
        },
        select: { id: true },
      });
      await tx.rationItem.createMany({ data: itemRows(id, dto.items) });
      const response = await this.load(tx, id);
      await this.audit.record(
        {
          action: AuditAction.RATION_CREATED,
          resourceType: 'ration',
          resourceId: id,
          newValue: rationAuditValue(response),
        },
        tx,
      );
      return response;
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateRationDto,
  ): Promise<RationResponse> {
    if (dto.items) assertNoDuplicateItems(dto.items);
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: an issue (FOR SHARE) never sees a half-replaced list.
      const locked = await lockOwnedRation(tx, ownerId, id, 'UPDATE');
      if (locked.archivedAt) throw RationErrors.archived();
      const before = await this.load(tx, locked.id);

      const type =
        dto.animalTypeId === undefined
          ? before.animalType
          : await lockAnimalType(tx, locked.farmId, dto.animalTypeId);
      // The merged result must fit the (possibly new) type's profile.
      assertParameters(type.profile, {
        purpose: dto.purpose ?? before.purpose,
        physiologicalState:
          dto.physiologicalState === undefined
            ? before.physiologicalState
            : dto.physiologicalState,
        milkYieldLiters:
          dto.milkYieldLiters === undefined
            ? before.milkYieldLiters
            : dto.milkYieldLiters,
      });
      if (dto.items) {
        await this.assertUsableItems(tx, locked.farmId, dto.items);
        await tx.rationItem.deleteMany({ where: { rationId: locked.id } });
        await tx.rationItem.createMany({
          data: itemRows(locked.id, dto.items),
        });
      }
      await tx.ration.update({
        where: { id: locked.id },
        data: {
          animalTypeId: dto.animalTypeId,
          name: dto.name,
          animalCount: dto.animalCount,
          averageWeightKg: dto.averageWeightKg,
          ageMonths: dto.ageMonths,
          purpose: dto.purpose,
          physiologicalState: dto.physiologicalState,
          milkYieldLiters: dto.milkYieldLiters,
          days: dto.days,
          notes: notesValue(dto.notes),
        },
      });
      const response = await this.load(tx, locked.id);
      await this.audit.record(
        {
          action: AuditAction.RATION_UPDATED,
          resourceType: 'ration',
          resourceId: locked.id,
          oldValue: rationAuditValue(before),
          newValue: rationAuditValue(response),
        },
        tx,
      );
      return response;
    });
  }

  /**
   * Same parameters and feeds under a new name; feeds archived since are
   * left out (none left → 422 RATION_ITEM_INVALID).
   */
  async copy(
    ownerId: string,
    id: string,
    dto: CopyRationDto,
  ): Promise<RationResponse> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockOwnedRation(tx, ownerId, id, 'SHARE');
      if (locked.archivedAt) throw RationErrors.archived();
      const farmId = await lockActiveFarm(tx, ownerId, locked.farmId);
      const type = await lockAnimalType(tx, farmId, locked.animalTypeId);
      const source = await this.load(tx, locked.id);
      assertParameters(type.profile, source);

      const usable = await lockUsableFeedItems(
        tx,
        farmId,
        source.items.map((line) => line.inventoryItemId),
      );
      const items = source.items.filter((line) =>
        usable.has(line.inventoryItemId),
      );
      if (items.length === 0) {
        throw RationErrors.itemInvalid(source.items[0].inventoryItemId);
      }

      const { id: copyId } = await tx.ration.create({
        data: {
          farmId,
          animalTypeId: type.id,
          name:
            dto.name ??
            truncate(`${source.name}${COPY_SUFFIX}`, RATION_NAME_MAX).trimEnd(),
          animalCount: source.animalCount,
          averageWeightKg: source.averageWeightKg,
          ageMonths: source.ageMonths,
          purpose: source.purpose,
          physiologicalState: source.physiologicalState,
          milkYieldLiters: source.milkYieldLiters,
          days: source.days,
          notes: source.notes,
        },
        select: { id: true },
      });
      await tx.rationItem.createMany({ data: itemRows(copyId, items) });
      const response = await this.load(tx, copyId);
      await this.audit.record(
        {
          action: AuditAction.RATION_CREATED,
          resourceType: 'ration',
          resourceId: copyId,
          newValue: { ...rationAuditValue(response), copiedFromId: source.id },
        },
        tx,
      );
      return response;
    });
  }

  /** Soft delete ("o‘chirish"): the ration and its issues stay as history. */
  async archive(ownerId: string, id: string): Promise<RationResponse> {
    return this.prisma.$transaction(async (tx) => {
      const archivedAt = new Date();
      const { count } = await tx.ration.updateMany({
        where: { ...owned(ownerId, id), archivedAt: null },
        data: { archivedAt },
      });
      const row = await tx.ration.findFirst({
        where: owned(ownerId, id),
        include: RATION_INCLUDE,
      });
      if (!row) throw Errors.notFound();
      if (count === 0) throw RationErrors.archived();
      await this.audit.record(
        {
          action: AuditAction.RATION_ARCHIVED,
          resourceType: 'ration',
          resourceId: row.id,
          oldValue: { archivedAt: null },
          newValue: { archivedAt },
        },
        tx,
      );
      const [response] = await this.present(tx, [row]);
      return response;
    });
  }

  /** 422 RATION_ITEM_INVALID for the first item that cannot be used. */
  private async assertUsableItems(
    tx: Tx,
    farmId: string,
    items: readonly RationItemDto[],
  ): Promise<void> {
    const usable = await lockUsableFeedItems(
      tx,
      farmId,
      items.map((item) => item.inventoryItemId),
    );
    const invalid = items.find((item) => !usable.has(item.inventoryItemId));
    if (invalid) throw RationErrors.itemInvalid(invalid.inventoryItemId);
  }

  private async load(tx: Tx, id: string): Promise<RationResponse> {
    const row = await tx.ration.findUniqueOrThrow({
      where: { id },
      include: RATION_INCLUDE,
    });
    const [response] = await this.present(tx, [row]);
    return response;
  }

  /** Responses with each ration's last issue (one extra query in all). */
  private async present(
    db: Tx | PrismaService,
    rows: RationRow[],
  ): Promise<RationResponse[]> {
    const lastIssues = await lastIssuesOf(
      db,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      toRationResponse(row, lastIssues.get(row.id) ?? null),
    );
  }
}
