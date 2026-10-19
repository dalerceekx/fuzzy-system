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
import { MedicineStatus, UserRole } from '../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type {
  CreateMedicineDto,
  ListMedicinesQueryDto,
  UpdateMedicineDto,
} from './dto/medicine.dto.js';
import {
  assertSameDemoScope,
  likeLiteral,
  lockActor,
  lockRow,
  VET_APPROVER_ROLES,
  VET_EDITOR_ROLES,
} from './vet-db.js';
import { VetErrors } from './vet.errors.js';
import {
  medicineAuditValue,
  toMedicineResponse,
  type MedicineResponse,
} from './vet.presenter.js';

const MEDICINE_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  name: (dir: Prisma.SortOrder) => ({ name: dir }),
};

/** Farmers only ever see approved, non-demo medicines. */
export function medicineVisibility(
  user: Pick<AuthUser, 'role'>,
): Prisma.MedicineWhereInput {
  return user.role === UserRole.FARMER
    ? { status: MedicineStatus.APPROVED, isDemo: false }
    : {};
}

@Injectable()
export class MedicinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: ListMedicinesQueryDto,
  ): Promise<Paginated<MedicineResponse>> {
    const where: Prisma.MedicineWhereInput = {
      AND: [
        medicineVisibility(user),
        query.status ? { status: query.status } : {},
        query.q
          ? {
              OR: [
                {
                  name: { contains: likeLiteral(query.q), mode: 'insensitive' },
                },
                {
                  activeIngredient: {
                    contains: likeLiteral(query.q),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {},
      ],
    };
    const orderBy = [
      ...buildOrderBy(query.sort, MEDICINE_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.MedicineOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.medicine.findMany({ where, orderBy, ...toSkipTake(query) }),
      this.prisma.medicine.count({ where }),
    ]);
    const staffView = user.role !== UserRole.FARMER;
    return paginated(
      rows.map((row) => toMedicineResponse(row, staffView)),
      total,
      query,
    );
  }

  async get(user: AuthUser, id: string): Promise<MedicineResponse> {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id, ...medicineVisibility(user) },
    });
    if (!medicine) throw Errors.notFound();
    return toMedicineResponse(medicine, user.role !== UserRole.FARMER);
  }

  create(user: AuthUser, dto: CreateMedicineDto): Promise<MedicineResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      const medicine = await tx.medicine.create({
        data: {
          name: dto.name,
          activeIngredient: dto.activeIngredient,
          form: dto.form ?? null,
          concentration: dto.concentration ?? null,
          withdrawalMeatDays: dto.withdrawalMeatDays,
          withdrawalMilkDays: dto.withdrawalMilkDays,
          // Demo accounts only ever produce demo (never approvable) data.
          isDemo: actor.isDemo,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.MEDICINE_CREATED,
          resourceType: 'medicine',
          resourceId: medicine.id,
          newValue: medicineAuditValue(medicine),
        },
        tx,
      );
      return toMedicineResponse(medicine, true);
    });
  }

  update(
    user: AuthUser,
    id: string,
    dto: UpdateMedicineDto,
  ): Promise<MedicineResponse> {
    const data: Prisma.MedicineUpdateInput = {
      name: dto.name,
      activeIngredient: dto.activeIngredient,
      form: dto.form,
      concentration: dto.concentration,
      withdrawalMeatDays: dto.withdrawalMeatDays,
      withdrawalMilkDays: dto.withdrawalMilkDays,
    };
    if (Object.values(data).every((value) => value === undefined)) {
      throw VetErrors.emptyUpdate();
    }
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      const before = await this.lockMedicine(tx, id);
      assertSameDemoScope(actor, before.isDemo);
      if (before.status !== MedicineStatus.DRAFT) {
        throw VetErrors.medicineImmutable();
      }
      const after = await tx.medicine.update({ where: { id }, data });
      await this.audit.record(
        {
          action: AuditAction.MEDICINE_UPDATED,
          resourceType: 'medicine',
          resourceId: id,
          oldValue: medicineAuditValue(before),
          newValue: medicineAuditValue(after),
        },
        tx,
      );
      return toMedicineResponse(after, true);
    });
  }

  approve(user: AuthUser, id: string): Promise<MedicineResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_APPROVER_ROLES);
      const before = await this.lockMedicine(tx, id);
      if (before.status !== MedicineStatus.DRAFT) {
        throw VetErrors.medicineNotDraft();
      }
      // Demo data is never validated, and demo accounts validate nothing.
      if (before.isDemo || actor.isDemo) throw VetErrors.demoNotApprovable();
      const after = await tx.medicine.update({
        where: { id },
        data: {
          status: MedicineStatus.APPROVED,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: AuditAction.MEDICINE_APPROVED,
          resourceType: 'medicine',
          resourceId: id,
          oldValue: { status: before.status },
          newValue: medicineAuditValue(after),
        },
        tx,
      );
      return toMedicineResponse(after, true);
    });
  }

  archive(user: AuthUser, id: string): Promise<MedicineResponse> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockActor(tx, user.id, VET_EDITOR_ROLES);
      const before = await this.lockMedicine(tx, id);
      assertSameDemoScope(actor, before.isDemo);
      if (before.status === MedicineStatus.ARCHIVED) {
        throw VetErrors.medicineArchived();
      }
      const after = await tx.medicine.update({
        where: { id },
        data: { status: MedicineStatus.ARCHIVED },
      });
      await this.audit.record(
        {
          action: AuditAction.MEDICINE_ARCHIVED,
          resourceType: 'medicine',
          resourceId: id,
          oldValue: { status: before.status },
          newValue: { status: after.status },
        },
        tx,
      );
      return toMedicineResponse(after, true);
    });
  }

  private async lockMedicine(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'medicines', id))) throw Errors.notFound();
    return tx.medicine.findUniqueOrThrow({ where: { id } });
  }
}
