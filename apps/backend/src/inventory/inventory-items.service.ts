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
import { dateOnlyToDate } from '../common/time.js';
import type { InventoryItem, Prisma } from '../generated/prisma/client.js';
import {
  InventoryCategory,
  StockMovementType,
} from '../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { CreateInventoryItemDto } from './dto/create-item.dto.js';
import type { ListInventoryItemsQueryDto } from './dto/list-items-query.dto.js';
import type { UpdateInventoryItemDto } from './dto/update-item.dto.js';
import { InventoryErrors } from './inventory.errors.js';
import {
  toItemResponse,
  type InventoryItemResponse,
} from './inventory.presenter.js';
import { decimalString, QUANTITY_SCALE } from './stock-balance.js';
import { StockMovementsService } from './stock-movements.service.js';

/** Reason of the IN movement recorded for `initialQuantity`. */
export const INITIAL_STOCK_REASON = 'Boshlang‘ich qoldiq';
/** Prices (unitPrice) are in so‘m. */
const INITIAL_CURRENCY = 'UZS';

const ITEM_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  name: (dir: Prisma.SortOrder) => ({ name: dir }),
  expiresOn: (dir: Prisma.SortOrder) => ({
    expiresOn: { sort: dir, nulls: 'last' },
  }),
};

/** Ownership is always part of the query: other farmers' items are 404. */
export function ownedItemWhere(
  ownerId: string,
  id: string,
): Prisma.InventoryItemWhereInput {
  return { id, farm: { ownerId } };
}

@Injectable()
export class InventoryItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly movements: StockMovementsService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    if (dto.medicineId && dto.category !== InventoryCategory.MEDICINE) {
      throw InventoryErrors.medicineCategoryRequired();
    }
    return this.prisma.$transaction(async (tx) => {
      // FOR SHARE makes a concurrent farm archive (FOR UPDATE, then "no
      // active items" check) wait for this insert, so an archived farm never
      // gains an active item. If the archive commits first, the re-checked
      // row no longer matches `archived_at IS NULL` and this is a 404.
      const [farm] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM farms
        WHERE id = ${dto.farmId}::uuid
          AND owner_id = ${ownerId}::uuid
          AND archived_at IS NULL
        FOR SHARE`;
      if (!farm) throw Errors.notFound();
      if (dto.medicineId) await this.lockApprovedMedicine(tx, dto.medicineId);
      // Initial stock is a stock movement: same actor re-check as any other.
      if (dto.initialQuantity) {
        await this.movements.assertActorAllowed(tx, ownerId);
      }

      // Quantity starts at 0: stock changes only through movements.
      const created = await tx.inventoryItem.create({
        data: {
          farmId: farm.id,
          name: dto.name,
          category: dto.category,
          unit: dto.unit,
          medicineId: dto.medicineId ?? null,
          batchNumber: dto.batchNumber ?? null,
          expiresOn: dto.expiresOn ? dateOnlyToDate(dto.expiresOn) : null,
          useWithinDaysAfterOpening: dto.useWithinDaysAfterOpening ?? null,
          unitPrice: dto.unitPrice ?? null,
          minQuantity: dto.minQuantity ?? null,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.INVENTORY_ITEM_CREATED,
          resourceType: 'inventory_item',
          resourceId: created.id,
          newValue: toItemResponse(created),
        },
        tx,
      );
      if (!dto.initialQuantity) return toItemResponse(created);

      // The row was inserted by this transaction, so nobody else can see
      // (let alone lock) it yet: it is as good as locked FOR UPDATE.
      await this.movements.applyToLockedItem(
        tx,
        ownerId,
        { id: created.id, farmId: created.farmId, quantity: '0' },
        {
          type: StockMovementType.IN,
          quantity: dto.initialQuantity,
          unitCost: dto.unitPrice ?? null,
          currency: dto.unitPrice === undefined ? null : INITIAL_CURRENCY,
          reason: INITIAL_STOCK_REASON,
        },
      );
      return toItemResponse(
        await tx.inventoryItem.findUniqueOrThrow({ where: { id: created.id } }),
      );
    });
  }

  async list(
    ownerId: string,
    query: ListInventoryItemsQueryDto,
  ): Promise<Paginated<InventoryItemResponse>> {
    const where: Prisma.InventoryItemWhereInput = {
      farm: { ownerId },
      ...(query.farmId ? { farmId: query.farmId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, ITEM_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.InventoryItemOrderByWithRelationInput[];
    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return paginated(items.map(toItemResponse), total, query);
  }

  async get(ownerId: string, id: string): Promise<InventoryItemResponse> {
    return toItemResponse(await this.findOwned(this.prisma, ownerId, id));
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    const expiresOn =
      dto.expiresOn === undefined || dto.expiresOn === null
        ? dto.expiresOn
        : dateOnlyToDate(dto.expiresOn);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockOwned(tx, ownerId, id);
      if (current.archivedAt) throw InventoryErrors.archived();
      if (current.category === InventoryCategory.MEDICINE) {
        assertShelfLifeNotExtended(current, {
          expiresOn,
          useWithinDaysAfterOpening: dto.useWithinDaysAfterOpening,
        });
      }
      const item = await tx.inventoryItem.update({
        where: { id: current.id },
        data: {
          name: dto.name,
          batchNumber: dto.batchNumber,
          expiresOn,
          useWithinDaysAfterOpening: dto.useWithinDaysAfterOpening,
          unitPrice: dto.unitPrice,
          minQuantity: dto.minQuantity,
        },
      });
      return toItemResponse(item);
    });
  }

  /** Records when a package was opened (shelf life after opening). Once only. */
  async open(ownerId: string, id: string): Promise<InventoryItemResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.inventoryItem.updateMany({
        where: {
          ...ownedItemWhere(ownerId, id),
          archivedAt: null,
          openedAt: null,
        },
        data: { openedAt: new Date() },
      });
      const item = await this.findOwned(tx, ownerId, id);
      if (count === 0) {
        throw item.archivedAt
          ? InventoryErrors.archived()
          : InventoryErrors.alreadyOpened();
      }
      return toItemResponse(item);
    });
  }

  /** Soft delete: the item and its ledger stay for history and audits. */
  async archive(ownerId: string, id: string): Promise<InventoryItemResponse> {
    return this.prisma.$transaction(async (tx) => {
      const archivedAt = new Date();
      const { count } = await tx.inventoryItem.updateMany({
        where: { ...ownedItemWhere(ownerId, id), archivedAt: null },
        data: { archivedAt },
      });
      const item = await this.findOwned(tx, ownerId, id);
      if (count === 0) throw InventoryErrors.archived();
      await this.audit.record(
        {
          action: AuditAction.INVENTORY_ITEM_ARCHIVED,
          resourceType: 'inventory_item',
          resourceId: item.id,
          oldValue: { archivedAt: null },
          newValue: {
            archivedAt,
            quantity: decimalString(item.quantity, QUANTITY_SCALE),
          },
        },
        tx,
      );
      return toItemResponse(item);
    });
  }

  async findOwned(
    db: Tx | PrismaService,
    ownerId: string,
    id: string,
  ): Promise<InventoryItem> {
    const item = await db.inventoryItem.findFirst({
      where: ownedItemWhere(ownerId, id),
    });
    if (!item) throw Errors.notFound();
    return item;
  }

  /** Owned item (archived or not) locked for this transaction; else 404. */
  private async lockOwned(
    tx: Tx,
    ownerId: string,
    id: string,
  ): Promise<InventoryItem> {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT i.id FROM inventory_items i
      JOIN farms f ON f.id = i.farm_id
      WHERE i.id = ${id}::uuid AND f.owner_id = ${ownerId}::uuid
      FOR UPDATE OF i`;
    if (!row) throw Errors.notFound();
    return tx.inventoryItem.findUniqueOrThrow({ where: { id: row.id } });
  }

  /**
   * The medicine must be APPROVED; FOR SHARE keeps it from being archived
   * until this transaction commits. Unknown and unapproved medicines get the
   * same answer (farmers never learn about drafts).
   */
  private async lockApprovedMedicine(tx: Tx, medicineId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM medicines
      WHERE id = ${medicineId}::uuid AND status = 'APPROVED'
      FOR SHARE`;
    if (rows.length === 0) throw InventoryErrors.medicineNotApproved();
  }
}

/**
 * Treatments refuse expired medicine using these two fields, so on MEDICINE
 * items they may be added or tightened but never cleared or extended — that
 * would silently turn an expired stock usable again (PATCH has no audit
 * action). A wrong date is fixed by archiving the item and creating a new one.
 */
function assertShelfLifeNotExtended(
  current: Pick<InventoryItem, 'expiresOn' | 'useWithinDaysAfterOpening'>,
  next: {
    expiresOn?: Date | null;
    useWithinDaysAfterOpening?: number | null;
  },
): void {
  const time = (d: Date | null | undefined) => (d ? d.getTime() : d);
  const loosened = (
    from: number | null | undefined,
    to: number | null | undefined,
  ) => from != null && to !== undefined && (to === null || to > from);
  if (
    loosened(time(current.expiresOn), time(next.expiresOn)) ||
    loosened(current.useWithinDaysAfterOpening, next.useWithinDaysAfterOpening)
  ) {
    throw InventoryErrors.shelfLifeLocked();
  }
}
