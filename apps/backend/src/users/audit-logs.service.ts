import { Injectable } from '@nestjs/common';
import type { AuditActionValue } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

/** Rows are returned exactly as stored (already sanitized at write time). */
const AUDIT_LOG_SELECT = {
  id: true,
  timestamp: true,
  actorId: true,
  actorRole: true,
  action: true,
  resourceType: true,
  resourceId: true,
  oldValue: true,
  newValue: true,
  ip: true,
  userAgent: true,
  requestId: true,
} as const satisfies Prisma.AuditLogSelect;

export type AuditLogView = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

// TODO(foundation): replace with AuditAction.AUDIT_LOGS_VIEWED once it is
// added to src/audit/audit-actions.ts (owned by another module).
export const AUDIT_LOGS_VIEWED =
  'audit.logs_viewed' as string as AuditActionValue;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const SORT_MAPPING = {
  timestamp: (dir: 'asc' | 'desc') => ({ timestamp: dir }),
};

/** Read-only: the table is append-only and no mutation route exists. */
@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogView>> {
    const from = query.from ? new Date(query.from) : undefined;
    // A date-only "to" means "up to the end of that (UTC) day".
    const toExclusive =
      query.to && DATE_ONLY.test(query.to)
        ? new Date(new Date(query.to).getTime() + DAY_MS)
        : undefined;
    const to = query.to && !toExclusive ? new Date(query.to) : undefined;
    if (from && ((to && from > to) || (toExclusive && from >= toExclusive))) {
      throw Errors.badRequest(
        'INVALID_DATE_RANGE',
        '“from” vaqti “to” vaqtidan keyin bo‘lmasligi kerak',
      );
    }
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        // Demo actors see only what demo users did (never real activity).
        actor.isDemo ? { actor: { isDemo: true } } : {},
        query.action ? { action: query.action } : {},
        query.actorId ? { actorId: query.actorId } : {},
        query.resourceType ? { resourceType: query.resourceType } : {},
        query.resourceId ? { resourceId: query.resourceId } : {},
        from || to || toExclusive
          ? { timestamp: { gte: from, lte: to, lt: toExclusive } }
          : {},
      ],
    };
    const orderBy = [
      ...buildOrderBy(query.sort, SORT_MAPPING, { timestamp: 'desc' }),
      { id: 'desc' },
    ] as Prisma.AuditLogOrderByWithRelationInput[];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
        select: AUDIT_LOG_SELECT,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    // Reading the trail is itself audited: rows hold other users' IPs,
    // user agents and actions.
    await this.audit.record({
      action: AUDIT_LOGS_VIEWED,
      resourceType: 'audit_log',
      newValue: {
        filters: {
          action: query.action ?? null,
          actorId: query.actorId ?? null,
          resourceType: query.resourceType ?? null,
          resourceId: query.resourceId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          sort: query.sort ?? null,
        },
        page: query.page,
        limit: query.limit,
        returned: items.length,
      },
    });
    return paginated(items, total, query);
  }
}
