import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { Prisma } from '../generated/prisma/client.js';
import { StockMovementType } from '../generated/prisma/enums.js';
import {
  IdempotencyService,
  type IdempotentResult,
} from '../idempotency/idempotency.service.js';
import {
  InventoryErrors,
  isNegativeStockViolation,
} from '../inventory/inventory.errors.js';
import {
  toMovementResponse,
  type StockMovementResponse,
} from '../inventory/inventory.presenter.js';
import {
  StockMovementsService,
  type LockedStockItem,
} from '../inventory/stock-movements.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type {
  IssueRationDto,
  ListRationIssuesQueryDto,
} from './dto/issue.dto.js';
import { issueReason, planIssue } from './ration-quantities.js';
import { RationErrors } from './rations.errors.js';
import {
  compareMovements,
  toIssueResponse,
  type RationIssueResponse,
} from './rations.presenter.js';

export const ISSUE_IDEMPOTENCY_SCOPE = 'rations.issue.create';

interface LockedIssueRation {
  id: string;
  farmId: string;
  name: string;
  animalCount: number;
  archivedAt: Date | null;
}

interface LockedFeedItem extends LockedStockItem {
  name: string;
  archivedAt: Date | null;
}

@Injectable()
export class RationIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly movements: StockMovementsService,
  ) {}

  /**
   * Takes `days` feeding days of the ration out of stock, exactly once per
   * Idempotency-Key and all-or-nothing: one OUT movement per feed, or — if
   * any feed is short — nothing at all (409 INSUFFICIENT_STOCK listing the
   * short feeds). Same isolation as single stock movements (READ COMMITTED
   * + row locks); the items are locked in id order, so concurrent issues
   * and movements on overlapping items cannot deadlock.
   */
  issue(
    userId: string,
    rationId: string,
    key: string,
    dto: IssueRationDto,
  ): Promise<IdempotentResult<RationIssueResponse> & { replayed: boolean }> {
    const request = { rationId, days: dto.days };
    return this.idempotency.execute<RationIssueResponse>(
      { userId, scope: ISSUE_IDEMPOTENCY_SCOPE, key, request },
      async (tx) => {
        try {
          return {
            status: 201,
            body: await this.record(tx, userId, rationId, dto.days),
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

  /** Newest first; each issue with its movements. */
  async list(
    ownerId: string,
    rationId: string,
    query: ListRationIssuesQueryDto,
  ): Promise<Paginated<RationIssueResponse>> {
    const ration = await this.prisma.ration.findFirst({
      where: { id: rationId, farm: { ownerId } },
      select: { id: true },
    });
    if (!ration) throw Errors.notFound();
    const where: Prisma.RationIssueWhereInput = {
      rationId: ration.id,
      farm: { ownerId },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rationIssue.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          movements: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
        ...toSkipTake(query),
      }),
      this.prisma.rationIssue.count({ where }),
    ]);
    return paginated(
      rows.map(({ movements, ...issue }) =>
        toIssueResponse(issue, movements.map(toMovementResponse)),
      ),
      total,
      query,
    );
  }

  private async record(
    tx: Tx,
    userId: string,
    rationId: string,
    days: number,
  ): Promise<RationIssueResponse> {
    await this.movements.assertActorAllowed(tx, userId);

    // FOR SHARE: PATCH (FOR UPDATE) cannot replace the feed list and the
    // ration cannot be archived until this issue commits. Like stock
    // movements, a ration of an archived farm is a 404.
    const [ration] = await tx.$queryRaw<LockedIssueRation[]>`
      SELECT r.id, r.farm_id AS "farmId", r.name,
             r.animal_count AS "animalCount", r.archived_at AS "archivedAt"
      FROM rations r
      WHERE r.id = ${rationId}::uuid
        AND r.farm_id IN (
          SELECT f.id FROM farms f
          WHERE f.owner_id = ${userId}::uuid AND f.archived_at IS NULL
        )
      FOR SHARE OF r`;
    if (!ration) throw Errors.notFound();
    if (ration.archivedAt) throw RationErrors.archived();

    const lines = await tx.rationItem.findMany({
      where: { rationId: ration.id },
      orderBy: { position: 'asc' },
    });
    const items = await this.lockItems(
      tx,
      ration.farmId,
      lines.map((line) => line.inventoryItemId),
    );
    const inputs = lines.map((line) => {
      const item = items.get(line.inventoryItemId);
      if (!item || item.archivedAt) {
        throw RationErrors.itemArchived(line.inventoryItemId);
      }
      return {
        inventoryItemId: item.id,
        name: item.name,
        dailyPerAnimal: line.dailyPerAnimal,
        available: item.quantity,
      };
    });
    const plan = planIssue(inputs, ration.animalCount, days);
    // Checked for every feed before anything is written.
    if (plan.shortages.length > 0) {
      throw InventoryErrors.insufficientStock({ items: plan.shortages });
    }

    const issue = await tx.rationIssue.create({
      data: {
        rationId: ration.id,
        farmId: ration.farmId,
        days,
        animalCount: ration.animalCount,
        actorId: userId,
      },
    });
    const reason = issueReason(ration.name, days);
    const movements: StockMovementResponse[] = [];
    for (const line of plan.lines) {
      const item = items.get(line.inventoryItemId)!;
      movements.push(
        await this.movements.applyToLockedItem(tx, userId, item, {
          type: StockMovementType.OUT,
          quantity: line.required,
          reason,
          rationIssueId: issue.id,
        }),
      );
    }
    await this.audit.record(
      {
        action: AuditAction.RATION_ISSUED,
        resourceType: 'ration_issue',
        resourceId: issue.id,
        newValue: {
          rationId: ration.id,
          farmId: ration.farmId,
          days,
          animalCount: ration.animalCount,
          movements: [...movements].sort(compareMovements).map((m) => ({
            movementId: m.id,
            itemId: m.itemId,
            quantity: m.quantity,
            balanceAfter: m.balanceAfter,
          })),
        },
      },
      tx,
    );
    return toIssueResponse(issue, movements);
  }

  /** The ration's items locked FOR UPDATE in id order (deadlock-safe). */
  private async lockItems(
    tx: Tx,
    farmId: string,
    ids: readonly string[],
  ): Promise<Map<string, LockedFeedItem>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedFeedItem[]>`
      SELECT i.id, i.farm_id AS "farmId", i.name,
             i.quantity::text AS quantity, i.archived_at AS "archivedAt"
      FROM inventory_items i
      WHERE i.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND i.farm_id = ${farmId}::uuid
      ORDER BY i.id
      FOR UPDATE`;
    return new Map(rows.map((row) => [row.id, row]));
  }
}
