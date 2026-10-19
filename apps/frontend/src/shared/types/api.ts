/**
 * Types shared by every feature, mirroring the backend contract
 * (apps/backend: common/pagination, common/errors, common/selects).
 * Decimal columns arrive as strings; timestamps as ISO strings; @db.Date
 * columns as 'YYYY-MM-DD'.
 */

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET', 'FARMER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'BLOCKED', 'ARCHIVED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** USER_PUBLIC_SELECT — the only user shape the API ever returns. */
export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  phoneVerifiedAt: string | null;
  mfaEnabled: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  blockedAt: string | null;
  archivedAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface PageQuery {
  page?: number;
  limit?: number;
  /** '<field>' ascending or '-<field>' descending; field from the endpoint's allowlist. */
  sort?: string;
}

/** Error body produced by the backend's global exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId?: string;
  details?: Record<string, unknown>;
}

/** Backend list endpoints cap `limit` at 100. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;
