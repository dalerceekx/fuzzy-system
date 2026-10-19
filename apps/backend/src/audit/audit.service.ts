import { Injectable } from '@nestjs/common';
import { RequestContext } from '../common/context/request-context.js';
import { truncateOptional } from '../common/strings.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { AuditActionValue } from './audit-actions.js';
import { sanitizeAuditValue } from './audit-sanitize.js';

export type AuditResourceType =
  | 'user'
  | 'session'
  | 'medicine'
  | 'protocol'
  | 'protocol_version'
  | 'inventory_item'
  | 'stock_movement'
  | 'ration_animal_type'
  | 'ration'
  | 'ration_issue'
  | 'animal'
  | 'treatment'
  | 'file'
  | 'system';

export interface AuditEntry {
  action: AuditActionValue;
  resourceType: AuditResourceType | (string & {});
  resourceId?: string | null;
  /** Default: RequestContext userId (null for anonymous requests). */
  actorId?: string | null;
  /** Default: RequestContext role. */
  actorRole?: UserRole | null;
  /** Sanitized before storing (see audit-sanitize.ts). */
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts one append-only row (UPDATE/DELETE/TRUNCATE are rejected by a
   * trigger). Pass `tx` to make it atomic with the audited change.
   */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const context = RequestContext.get();
    const pick = <T>(
      explicit: T | null | undefined,
      fallback: T | undefined,
    ): T | null => (explicit !== undefined ? explicit : (fallback ?? null));

    await (tx ?? this.prisma).auditLog.create({
      data: {
        action: entry.action,
        resourceType: entry.resourceType.slice(0, 50),
        resourceId: truncateOptional(entry.resourceId, 100) ?? null,
        actorId: pick(entry.actorId, context?.userId),
        actorRole: pick(entry.actorRole, context?.role),
        oldValue: sanitizeAuditValue(entry.oldValue),
        newValue: sanitizeAuditValue(entry.newValue),
        ip: truncateOptional(pick(entry.ip, context?.ip), 45) ?? null,
        userAgent:
          truncateOptional(pick(entry.userAgent, context?.userAgent), 512) ??
          null,
        requestId:
          truncateOptional(pick(entry.requestId, context?.requestId), 64) ??
          null,
        timestamp: new Date(),
      },
    });
  }
}
