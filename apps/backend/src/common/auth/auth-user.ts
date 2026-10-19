import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  /** Current role from the database, loaded on every request. */
  role: UserRole;
  sessionId: string;
  isDemo: boolean;
  mfaVerified: boolean;
}

export type AuthenticatedRequest = Request & {
  user: AuthUser;
  /** Request id (also returned as the X-Request-Id header). */
  id: string;
};

/** A request that may or may not have passed AccessTokenGuard yet. */
export type AppRequest = Request & { user?: AuthUser; id: string };
