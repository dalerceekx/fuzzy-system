import { http } from '@/shared/api/client';
import { cleanParams } from '@/shared/api/pagination';
import type { PageQuery, Paginated, UserRole } from '@/shared/types/api';

/** Append-only audit row, returned exactly as stored (already sanitized). */
export interface AuditLog {
  id: string;
  actorId: string | null;
  actorRole: UserRole | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  timestamp: string;
}

export interface AuditListQuery extends PageQuery {
  action?: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  /** ISO timestamps (inclusive range). */
  from?: string;
  to?: string;
}

/** GET /api/v1/admin/audit-logs — read-only; no mutation endpoint exists. */
export const auditApi = {
  async list(query: AuditListQuery = {}): Promise<Paginated<AuditLog>> {
    const { data } = await http.get<Paginated<AuditLog>>('/admin/audit-logs', {
      params: cleanParams({ sort: '-timestamp', ...query }),
    });
    return data;
  },
};
