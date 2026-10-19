import { Injectable } from '@nestjs/common';
import { AuditAction, type AuditActionValue } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  StockMovementType,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums.js';
import {
  IdempotencyService,
  type IdempotentResult,
} from '../idempotency/idempotency.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { CreateStockMovementDto } from './dto/create-movement.dto.js';
import type { ListStockMovementsQueryDto } from './dto/list-movements-query.dto.js';
import {
  InventoryErrors,
  isNegativeStockViolation,
} from './inventory.errors.js';
import {
  toMovementResponse,
  type StockMovementResponse,
} from './inventory.presenter.js';
import {
  applyMovement,
  decimalString,
  QUANTITY_SCALE,
} from './stock-balance.js';

export const MOVEMENT_IDEMPOTENCY_SCOPE = 'inventory.movement.create';

const AUDIT_ACTION: Record<StockMovementType, AuditActionValue> = {
  [StockMovementType.IN]: AuditAction.INVENTORY_STOCK_IN,
  [StockMovementType.OUT]: AuditAction.INVENTORY_STOCK_OUT,
  [StockMovementType.ADJUSTMENT_IN]: AuditAction.INVENTORY_STOCK_ADJUSTED,
  [StockMovementType.ADJUSTMENT_OUT]: AuditAction.INVENTORY_STOCK_ADJUSTED,
};

const MOVEMENT_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
};

/** An inventory item row the caller has locked FOR UPDATE in its transaction. */
export interface LockedStockItem {
  id: string;
  farmId: string;
  /** Quantity read under that lock (decimal string). */
  quantity: string;
}

/** One validated movement (decimal strings, quantity > 0). */
export interface StockMovementInput {
  type: StockMovementType;
  quantity: string;
  /** Together with `currency` (DB check enforces both-or-neither). */
  unitCost?: string | null;
  currency?: string | null;
  reason?: string | null;
  /** Only on the OUT movements of a ration issue (DB check). */
  rationIssueId?: string | null;
}

@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Records one movement exactly once per Idempotency-Key.
   *
   * Isolation: the idempotency transaction runs at READ COMMITTED and the
   * item row is locked with SELECT … FOR UPDATE. Concurrent movements on the
   * same item queue on that lock; when the holder commits, PostgreSQL
   * re-reads the newest committed row for the next waiter, so every
   * balance is computed from the latest quantity — no lost updates and no
   * serialization failures for clients to retry (SERIALIZABLE/REPEATABLE
   * READ would abort these conflicting writers with 40001 instead). The
   * CHECK (quantity >= 0) constraint is the last line of defense.
   */
  async create(
    userId: string,
    itemId: string,
    key: string,
    dto: CreateStockMovementDto,
  ): Promise<IdempotentResult<StockMovementResponse> & { replayed: boolean }> {
    // Everything that defines the request: the same key on another item or
    // with another body is a different request (409 IDEMPOTENCY_KEY_REUSED).
    const request = {
      itemId,
      type: dto.type,
      quantity: dto.quantity,
      unitCost: dto.unitCost ?? null,
      currency: dto.currency ?? null,
      reason: dto.reason ?? null,
    };
    return this.idempotency.execute<StockMovementResponse>(
      { userId, scope: MOVEMENT_IDEMPOTENCY_SCOPE, key, request },
      async (tx) => {
        try {
          return {
            status: 201,
            body: await this.record(tx, userId, itemId, dto),
          };
        } catch (err) {
          if (isNegativeStockViolation(err)) {
            throw InventoryErrors.insufficientStock();
          }
          throw err;
        }
      },
    );
  }

  async list(
    ownerId: string,
    itemId: string,
    query: ListStockMovementsQueryDto,
  ): Promise<Paginated<StockMovementResponse>> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, farm: { ownerId } },
      select: { id: true },
    });
    if (!item) throw Errors.notFound();
    const where: Prisma.StockMovementWhereInput = {
      itemId,
      farm: { ownerId },
    };
    const orderBy = [
      ...buildOrderBy(query.sort, MOVEMENT_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.StockMovementOrderByWithRelationInput[];
    const [movements, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginated(movements.map(toMovementResponse), total, query);
  }

  /**
   * The single write path of the stock ledger (movements, initial stock,
   * ration issues): applies one movement to an item the caller has already
   * locked FOR UPDATE in `tx` — balance check, item update, ledger row and
   * its `inventory.stock.*` audit row. A priced IN also becomes the item's
   * current unit price. Ownership and the actor are the caller's checks.
   */
  async applyToLockedItem(
    tx: Tx,
    actorId: string,
    item: LockedStockItem,
    input: StockMovementInput,
  ): Promise<StockMovementResponse> {
    const result = applyMovement(item.quantity, input.type, input.quantity);
    if (!result.ok) {
      throw result.reason === 'INSUFFICIENT_STOCK'
        ? InventoryErrors.insufficientStock()
        : InventoryErrors.stockLimitExceeded();
    }
    const unitCost =
      input.unitCost === undefined || input.unitCost === null
        ? null
        : new Prisma.Decimal(input.unitCost);

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: result.balance,
        ...(input.type === StockMovementType.IN && unitCost !== null
          ? { unitPrice: unitCost }
          : {}),
      },
    });
    const movement = await tx.stockMovement.create({
      data: {
        itemId: item.id,
        farmId: item.farmId,
        type: input.type,
        quantity: new Prisma.Decimal(input.quantity),
        balanceAfter: result.balance,
        unitCost,
        currency: input.currency ?? null,
        reason: input.reason ?? null,
        actorId,
        rationIssueId: input.rationIssueId ?? null,
      },
    });
    const response = toMovementResponse(movement);
    await this.audit.record(
      {
        action: AUDIT_ACTION[input.type],
        resourceType: 'stock_movement',
        resourceId: movement.id,
        oldValue: {
          itemId: item.id,
          quantity: decimalString(item.quantity, QUANTITY_SCALE),
        },
        newValue: {
          itemId: item.id,
          type: response.type,
          quantity: response.quantity,
          balanceAfter: response.balanceAfter,
          unitCost: response.unitCost,
          currency: response.currency,
          reason: response.reason,
          rationIssueId: response.rationIssueId,
        },
      },
      tx,
    );
    return response;
  }

  /**
   * Re-reads the actor inside the transaction (the guard ran earlier): a
   * farmer blocked or demoted in the meantime cannot move stock. FOR SHARE
   * makes a concurrent role/status change wait for this transaction.
   */
  async assertActorAllowed(tx: Tx, userId: string): Promise<void> {
    const [actor] = await tx.$queryRaw<
      Array<{ role: UserRole; status: UserStatus }>
    >`SELECT role, status FROM users WHERE id = ${userId}::uuid FOR SHARE`;
    if (
      !actor ||
      actor.role !== UserRole.FARMER ||
      actor.status !== UserStatus.ACTIVE
    ) {
      throw Errors.forbidden();
    }
  }

  private async record(
    tx: Tx,
    userId: string,
    itemId: string,
    dto: CreateStockMovementDto,
  ): Promise<StockMovementResponse> {
    await this.assertActorAllowed(tx, userId);

    // Ownership is part of the locking query: another farmer's item, an
    // archived item and an unknown id are indistinguishable (404).
    const [item] = await tx.$queryRaw<LockedStockItem[]>`
      SELECT i.id, i.farm_id AS "farmId", i.quantity::text AS quantity
      FROM inventory_items i
      WHERE i.id = ${itemId}::uuid
        AND i.archived_at IS NULL
        AND i.farm_id IN (
          SELECT f.id FROM farms f
          WHERE f.owner_id = ${userId}::uuid AND f.archived_at IS NULL
        )
      FOR UPDATE OF i`;
    if (!item) throw Errors.notFound();
    return this.applyToLockedItem(tx, userId, item, dto);
  }
}
