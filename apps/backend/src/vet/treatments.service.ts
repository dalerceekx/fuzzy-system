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
import { dateOnlyToDate, todayInTashkent, toDateOnly } from '../common/time.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  InventoryCategory,
  MedicineStatus,
  ProtocolVersionStatus,
  TreatmentStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import {
  IdempotencyService,
  type IdempotentResult,
} from '../idempotency/idempotency.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import {
  computeTreatmentPlan,
  decimalString,
  DOSE_SCALE,
  openedUseByDate,
  WEIGHT_SCALE,
  type TreatmentPlan,
} from './dosing.js';
import type {
  CreateTreatmentDto,
  ListTreatmentsQueryDto,
  TreatmentItemDto,
} from './dto/treatment.dto.js';
import { lockActor, lockRow, lockRows } from './vet-db.js';
import { VetErrors } from './vet.errors.js';
import {
  toTreatmentResponse,
  TREATMENT_INCLUDE,
  VERSION_INCLUDE,
  type TreatmentResponse,
} from './vet.presenter.js';

export const TREATMENT_IDEMPOTENCY_SCOPE = 'vet.treatment.create';

const FARMER_ONLY: readonly UserRole[] = [UserRole.FARMER];

const TREATMENT_ORDER_BY = {
  startedAt: (dir: Prisma.SortOrder) => ({ startedAt: dir }),
  endsOn: (dir: Prisma.SortOrder) => ({ endsOn: dir }),
};

type InventoryItemRow = Prisma.InventoryItemGetPayload<object>;

@Injectable()
export class TreatmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Starts a treatment exactly once per Idempotency-Key. */
  create(
    userId: string,
    key: string,
    dto: CreateTreatmentDto,
  ): Promise<IdempotentResult<TreatmentResponse> & { replayed: boolean }> {
    const request = {
      animalId: dto.animalId,
      protocolVersionId: dto.protocolVersionId,
      animalWeightKg: dto.animalWeightKg ?? null,
      items: (dto.items ?? []).map((item) => ({
        medicineId: item.medicineId,
        inventoryItemId: item.inventoryItemId ?? null,
      })),
      notes: dto.notes ?? null,
    };
    return this.idempotency.execute<TreatmentResponse>(
      { userId, scope: TREATMENT_IDEMPOTENCY_SCOPE, key, request },
      async (tx) => ({ status: 201, body: await this.start(tx, userId, dto) }),
    );
  }

  async list(
    ownerId: string,
    query: ListTreatmentsQueryDto,
  ): Promise<Paginated<TreatmentResponse>> {
    const where: Prisma.TreatmentWhereInput = {
      farm: { ownerId },
      ...(query.animalId ? { animalId: query.animalId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, TREATMENT_ORDER_BY, { startedAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.TreatmentOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.treatment.findMany({
        where,
        orderBy,
        include: TREATMENT_INCLUDE,
        ...toSkipTake(query),
      }),
      this.prisma.treatment.count({ where }),
    ]);
    return paginated(rows.map(toTreatmentResponse), total, query);
  }

  async get(ownerId: string, id: string): Promise<TreatmentResponse> {
    const treatment = await this.prisma.treatment.findFirst({
      where: { id, farm: { ownerId } },
      include: TREATMENT_INCLUDE,
    });
    if (!treatment) throw Errors.notFound();
    return toTreatmentResponse(treatment);
  }

  complete(ownerId: string, id: string): Promise<TreatmentResponse> {
    return this.finish(ownerId, id, TreatmentStatus.COMPLETED);
  }

  cancel(ownerId: string, id: string): Promise<TreatmentResponse> {
    return this.finish(ownerId, id, TreatmentStatus.CANCELLED);
  }

  // -------------------------------------------------------------------------

  /**
   * All clinical checks and the full snapshot in the idempotency
   * transaction. Every row the decision depends on is share-locked (animal,
   * protocol version, medicines, inventory items), so a concurrent archive,
   * supersede or edit waits until the treatment is committed and the
   * snapshot always matches what was checked.
   */
  private async start(
    tx: Tx,
    userId: string,
    dto: CreateTreatmentDto,
  ): Promise<TreatmentResponse> {
    await lockActor(tx, userId, FARMER_ONLY);

    // Ownership is part of the locking query: another farmer's animal, an
    // archived animal and an unknown id are indistinguishable (404).
    const [owned] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a.id::text AS id
      FROM animals a JOIN farms f ON f.id = a.farm_id
      WHERE a.id = ${dto.animalId}::uuid
        AND f.owner_id = ${userId}::uuid
        AND a.archived_at IS NULL
        AND f.archived_at IS NULL
      FOR SHARE OF a`;
    if (!owned) throw Errors.notFound();
    const animal = await tx.animal.findUniqueOrThrow({
      where: { id: owned.id },
    });

    await lockRow(tx, 'protocol_versions', dto.protocolVersionId, 'SHARE');
    const version = await tx.protocolVersion.findUnique({
      where: { id: dto.protocolVersionId },
      include: { ...VERSION_INCLUDE, protocol: true },
    });
    if (
      !version ||
      version.status !== ProtocolVersionStatus.APPROVED ||
      version.protocol.archivedAt !== null ||
      version.protocol.isDemo ||
      version.drugs.length === 0
    ) {
      throw VetErrors.protocolNotApproved();
    }
    // Emergency protocols are never turned into an automatic treatment.
    if (version.isEmergency) throw VetErrors.emergencyRequiresVet();
    if (version.protocol.species !== animal.species) {
      throw VetErrors.speciesMismatch();
    }

    const medicineIds = version.drugs.map((drug) => drug.medicineId);
    await lockRows(tx, 'medicines', medicineIds, 'SHARE');
    const medicines = new Map(
      (await tx.medicine.findMany({ where: { id: { in: medicineIds } } })).map(
        (m) => [m.id, m],
      ),
    );
    const notApproved = medicineIds.filter((id) => {
      const medicine = medicines.get(id);
      return medicine?.status !== MedicineStatus.APPROVED || medicine.isDemo;
    });
    if (notApproved.length > 0) {
      throw VetErrors.medicineNotApproved(notApproved);
    }

    const weight =
      dto.animalWeightKg !== undefined
        ? new Prisma.Decimal(dto.animalWeightKg)
        : animal.weightKg;
    if (weight === null || weight.lte(0)) throw VetErrors.weightRequired();

    const plan = computeTreatmentPlan(
      weight,
      todayInTashkent(),
      version.drugs.map((drug) => {
        const medicine = medicines.get(drug.medicineId)!;
        return {
          medicineId: drug.medicineId,
          dosePerKg: drug.dosePerKg,
          maxSingleDose: drug.maxSingleDose,
          durationDays: drug.durationDays,
          withdrawalMeatDays: medicine.withdrawalMeatDays,
          withdrawalMilkDays: medicine.withdrawalMilkDays,
        };
      }),
    );
    if (plan.drugs.some((drug) => drug.singleDose.lte(0))) {
      throw VetErrors.doseTooSmall();
    }

    const itemsByMedicine = await this.checkInventoryItems(
      tx,
      animal.farmId,
      medicineIds,
      dto.items ?? [],
      plan.endsOn,
    );

    const computedAt = new Date();
    const drugSnapshots = version.drugs.map((drug, index) => {
      const medicine = medicines.get(drug.medicineId)!;
      const drugPlan = plan.drugs[index];
      const item = itemsByMedicine.get(drug.medicineId);
      return {
        medicineId: drug.medicineId,
        medicineName: medicine.name,
        activeIngredient: medicine.activeIngredient,
        concentration: medicine.concentration,
        dosePerKg: decimalString(drug.dosePerKg, DOSE_SCALE),
        doseUnit: drug.doseUnit,
        maxSingleDose:
          drug.maxSingleDose === null
            ? null
            : decimalString(drug.maxSingleDose, DOSE_SCALE),
        singleDose: decimalString(drugPlan.singleDose, DOSE_SCALE),
        route: drug.route,
        frequencyPerDay: drug.frequencyPerDay,
        durationDays: drug.durationDays,
        lastDay: drugPlan.lastDay,
        withdrawalMeatDays: medicine.withdrawalMeatDays,
        withdrawalMilkDays: medicine.withdrawalMilkDays,
        withdrawalMeatUntil: drugPlan.withdrawalMeatUntil,
        withdrawalMilkUntil: drugPlan.withdrawalMilkUntil,
        inventoryItemId: item?.id ?? null,
        batchNumber: item?.batchNumber ?? null,
        itemExpiresOn: item?.expiresOn ? toDateOnly(item.expiresOn) : null,
      };
    });
    const weightKg = decimalString(weight, WEIGHT_SCALE);
    const snapshot = {
      schemaVersion: 1,
      computedAt: computedAt.toISOString(),
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      protocol: {
        id: version.protocol.id,
        protocolCode: version.protocol.code,
        species: version.protocol.species,
        versionId: version.id,
        version: version.version,
        title: version.title,
        condition: version.condition,
        instructions: version.instructions,
        approvedAt: version.approvedAt?.toISOString() ?? null,
      },
      animal: {
        id: animal.id,
        tagNumber: animal.tagNumber,
        name: animal.name,
        species: animal.species,
        weightKg,
        weightSource: dto.animalWeightKg !== undefined ? 'request' : 'animal',
      },
      drugs: drugSnapshots,
      withdrawal: {
        meatUntil: plan.withdrawalMeatUntil,
        milkUntil: plan.withdrawalMilkUntil,
      },
    };

    const treatment = await tx.treatment.create({
      data: {
        farmId: animal.farmId,
        animalId: animal.id,
        protocolVersionId: version.id,
        startedById: userId,
        startedAt: computedAt,
        endsOn: dateOnlyToDate(plan.endsOn),
        animalWeightKg: new Prisma.Decimal(weightKg),
        protocolSnapshot: snapshot,
        withdrawalMeatUntil: dateOnlyToDate(plan.withdrawalMeatUntil),
        withdrawalMilkUntil: dateOnlyToDate(plan.withdrawalMilkUntil),
        notes: dto.notes ?? null,
      },
    });
    await tx.treatmentDose.createMany({
      data: drugSnapshots.map((drug, index) => ({
        // treatment_doses has no sort column: strictly increasing timestamps
        // keep the protocol's drug order when doses are read back.
        createdAt: new Date(computedAt.getTime() + index),
        treatmentId: treatment.id,
        medicineId: drug.medicineId,
        inventoryItemId: drug.inventoryItemId,
        medicineName: drug.medicineName,
        dosePerKg: new Prisma.Decimal(drug.dosePerKg),
        doseUnit: drug.doseUnit,
        singleDose: new Prisma.Decimal(drug.singleDose),
        route: drug.route,
        frequencyPerDay: drug.frequencyPerDay,
        durationDays: drug.durationDays,
        withdrawalMeatDays: drug.withdrawalMeatDays,
        withdrawalMilkDays: drug.withdrawalMilkDays,
        batchNumber: drug.batchNumber,
        itemExpiresOn: drug.itemExpiresOn
          ? dateOnlyToDate(drug.itemExpiresOn)
          : null,
      })),
    });
    await this.audit.record(
      {
        action: AuditAction.TREATMENT_STARTED,
        resourceType: 'treatment',
        resourceId: treatment.id,
        newValue: {
          animalId: animal.id,
          protocolVersionId: version.id,
          protocolVersion: version.version,
          animalWeightKg: weightKg,
          endsOn: plan.endsOn,
          withdrawalMeatUntil: plan.withdrawalMeatUntil,
          withdrawalMilkUntil: plan.withdrawalMilkUntil,
          doses: drugSnapshots.map((drug) => ({
            medicineId: drug.medicineId,
            singleDose: drug.singleDose,
            doseUnit: drug.doseUnit,
            inventoryItemId: drug.inventoryItemId,
          })),
        },
      },
      tx,
    );
    return toTreatmentResponse(
      await tx.treatment.findUniqueOrThrow({
        where: { id: treatment.id },
        include: TREATMENT_INCLUDE,
      }),
    );
  }

  /**
   * Each referenced stock item must be a non-archived MEDICINE item of the
   * animal's farm for that exact medicine, and still usable on the last
   * treatment day — both by its expiry date and, once opened, by its
   * after-opening shelf life — and must still hold stock.
   */
  private async checkInventoryItems(
    tx: Tx,
    farmId: string,
    protocolMedicineIds: readonly string[],
    items: readonly TreatmentItemDto[],
    endsOn: TreatmentPlan['endsOn'],
  ): Promise<Map<string, InventoryItemRow>> {
    const medicineIds = items.map((item) => item.medicineId);
    if (new Set(medicineIds).size !== medicineIds.length) {
      throw VetErrors.duplicateMedicine();
    }
    if (medicineIds.some((id) => !protocolMedicineIds.includes(id))) {
      throw VetErrors.medicineNotInProtocol();
    }
    const withItem = items.filter(
      (item): item is TreatmentItemDto & { inventoryItemId: string } =>
        item.inventoryItemId !== undefined,
    );
    const itemIds = withItem.map((item) => item.inventoryItemId);
    await lockRows(tx, 'inventory_items', itemIds, 'SHARE');
    // Only the animal's own farm (which the caller owns) is searched:
    // another farmer's item is indistinguishable from an unknown id.
    const rows = new Map(
      (
        await tx.inventoryItem.findMany({
          where: { id: { in: itemIds }, farmId },
        })
      ).map((row) => [row.id, row]),
    );

    const result = new Map<string, InventoryItemRow>();
    for (const { medicineId, inventoryItemId } of withItem) {
      const row = rows.get(inventoryItemId);
      if (!row) throw Errors.notFound();
      if (
        row.category !== InventoryCategory.MEDICINE ||
        row.medicineId !== medicineId
      ) {
        throw VetErrors.inventoryItemMismatch();
      }
      if (row.archivedAt) throw VetErrors.inventoryItemArchived();
      if (row.quantity.lte(0)) throw VetErrors.inventoryItemEmpty();
      // An unknown expiry (or after-opening shelf life) is not treated as safe.
      if (!row.expiresOn) throw VetErrors.medicineExpiryUnknown();
      if (toDateOnly(row.expiresOn) < endsOn) throw VetErrors.medicineExpired();
      if (row.openedAt) {
        if (row.useWithinDaysAfterOpening === null) {
          throw VetErrors.medicineOpenedExpiryUnknown();
        }
        if (
          openedUseByDate(row.openedAt, row.useWithinDaysAfterOpening) < endsOn
        ) {
          throw VetErrors.medicineOpenedExpired();
        }
      }
      result.set(medicineId, row);
    }
    return result;
  }

  private finish(
    ownerId: string,
    id: string,
    status: 'COMPLETED' | 'CANCELLED',
  ): Promise<TreatmentResponse> {
    return this.prisma.$transaction(async (tx) => {
      await lockActor(tx, ownerId, FARMER_ONLY);
      const [owned] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT t.id::text AS id
        FROM treatments t JOIN farms f ON f.id = t.farm_id
        WHERE t.id = ${id}::uuid AND f.owner_id = ${ownerId}::uuid
        FOR UPDATE OF t`;
      if (!owned) throw Errors.notFound();
      const before = await tx.treatment.findUniqueOrThrow({ where: { id } });
      if (before.status !== TreatmentStatus.ACTIVE) {
        throw VetErrors.treatmentNotActive();
      }
      const now = new Date();
      const after = await tx.treatment.update({
        where: { id },
        data:
          status === TreatmentStatus.COMPLETED
            ? { status, completedAt: now }
            : { status, cancelledAt: now },
        include: TREATMENT_INCLUDE,
      });
      await this.audit.record(
        {
          action:
            status === TreatmentStatus.COMPLETED
              ? AuditAction.TREATMENT_COMPLETED
              : AuditAction.TREATMENT_CANCELLED,
          resourceType: 'treatment',
          resourceId: id,
          oldValue: { status: before.status },
          newValue: { status: after.status },
        },
        tx,
      );
      return toTreatmentResponse(after);
    });
  }
}
