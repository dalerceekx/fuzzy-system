import type { UserRole } from '../../src/generated/prisma/enums.js';
import { SessionService } from '../../src/security/sessions/session.service.js';
import type { TestApp } from './app.js';

export { totpNow } from './totp.js';

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  /** `{ Authorization: 'Bearer …' }` for supertest's `.set()`. */
  authHeader: { Authorization: string };
}

/**
 * Creates a real session for `user` (MFA treated as verified) without
 * going through the login endpoint.
 */
export async function loginAs(
  testApp: Pick<TestApp, 'app'>,
  user: { id: string; role: UserRole },
  meta: { ip?: string; userAgent?: string; mfaVerified?: boolean } = {},
): Promise<LoggedIn> {
  const sessions = testApp.app.get(SessionService);
  const issued = await sessions.createSession(
    { id: user.id, role: user.role },
    {
      ip: meta.ip ?? '127.0.0.1',
      userAgent: meta.userAgent ?? 'vitest',
      mfaVerified: meta.mfaVerified ?? true,
    },
  );
  return {
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    sessionId: issued.sessionId,
    authHeader: { Authorization: `Bearer ${issued.accessToken}` },
  };
}
