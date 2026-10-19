import { AuditAction } from '../../src/audit/audit-actions.js';
import {
  SessionRevokeReason,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { SessionService } from '../../src/security/sessions/session.service.js';
import { TokenService } from '../../src/security/tokens/token.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { ProbeController } from './support/probe.controller.js';
import { decodePayload } from './support/tokens.js';

const ME = '/api/v1/test-probe/me';

describe('SessionService: token families, rotation and reuse detection', () => {
  let testApp: TestApp;
  let sessions: SessionService;
  let tokens: TokenService;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
    sessions = testApp.app.get(SessionService);
    tokens = testApp.app.get(TokenService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const meta = { ip: '198.51.100.10', userAgent: 'sessions-test' };

  async function newFamily(role: UserRole = UserRole.FARMER) {
    const { user } = await createUser(testApp.prisma, { role });
    const issued = await sessions.createSession(
      { id: user.id, role },
      { ...meta, mfaVerified: role !== UserRole.FARMER },
    );
    return { user, issued };
  }

  it('createSession stores a family with an absolute expiry and issues both tokens', async () => {
    const { user, issued } = await newFamily();
    const row = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row).toMatchObject({
      userId: user.id,
      revokedAt: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const refresh = await tokens.verifyRefresh(issued.refreshToken);
    expect(refresh).toMatchObject({
      sub: user.id,
      sid: issued.sessionId,
      typ: 'refresh',
      jti: row.currentRefreshJti,
    });
    expect(refresh.exp).toBe(Math.floor(row.expiresAt.getTime() / 1000));
    expect(issued.refreshTokenExpiresAt.getTime()).toBe(refresh.exp * 1000);

    const access = await tokens.verifyAccess(issued.accessToken);
    expect(access).toMatchObject({
      sub: user.id,
      sid: issued.sessionId,
      typ: 'access',
    });
    expect(issued.accessTokenExpiresIn).toBe(
      Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    );
    for (const token of [issued.accessToken, issued.refreshToken]) {
      expect(JSON.stringify(decodePayload(token))).not.toMatch(
        /role|phone|FARMER|fullName/i,
      );
    }
  });

  it('refuses to create an MFA-less session for ADMIN/SUPER_ADMIN', async () => {
    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      const { user } = await createUser(testApp.prisma, {
        role,
        mfaEnabled: true,
      });
      await expect(
        sessions.createSession({ id: user.id, role }, { mfaVerified: false }),
      ).rejects.toMatchObject({
        code: 'MFA_REQUIRED',
      });
    }
  });

  it('rotates: new pair, same family, absolute lifetime never extended', async () => {
    const { issued } = await newFamily();
    const before = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    const rotated = await sessions.rotate(issued.refreshToken, meta);
    const after = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });

    expect(rotated.sessionId).toBe(issued.sessionId);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(after.currentRefreshJti).not.toBe(before.currentRefreshJti);
    expect(after.refreshCount).toBe(before.refreshCount + 1);
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(rotated.refreshTokenExpiresAt.getTime()).toBe(
      Math.floor(before.expiresAt.getTime() / 1000) * 1000,
    );
    await testApp
      .http()
      .get(ME)
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);
  });

  it('detects reuse of a rotated refresh token and revokes the whole family', async () => {
    const { user, issued } = await newFamily();
    const second = await sessions.rotate(issued.refreshToken, meta);

    // The old token has a valid signature but a stale jti → reuse.
    await expect(
      sessions.rotate(issued.refreshToken, {
        ip: '203.0.113.66',
        userAgent: 'attacker',
      }),
    ).rejects.toMatchObject({
      status: 401,
    });

    const row = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedReason).toBe(SessionRevokeReason.REFRESH_TOKEN_REUSE);

    const audit = await testApp.prisma.auditLog.findMany({
      where: {
        action: AuditAction.AUTH_REFRESH_REUSE,
        resourceId: issued.sessionId,
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: user.id,
      resourceType: 'session',
      ip: '203.0.113.66',
      userAgent: 'attacker',
    });
    expect(JSON.stringify(audit[0])).not.toContain(issued.refreshToken);

    // Every token of the family is dead now, including the newest ones.
    await expect(
      sessions.rotate(second.refreshToken, meta),
    ).rejects.toMatchObject({ status: 401 });
    await testApp
      .http()
      .get(ME)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(401);
    await testApp
      .http()
      .get(ME)
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(401);
  });

  it('concurrent rotations with the same token: one wins, the family is then revoked', async () => {
    const { issued } = await newFamily();
    const results = await Promise.allSettled([
      sessions.rotate(issued.refreshToken, meta),
      sessions.rotate(issued.refreshToken, meta),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.revokedReason).toBe(SessionRevokeReason.REFRESH_TOKEN_REUSE);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const { issued } = await newFamily();
    await expect(
      sessions.rotate(issued.accessToken, meta),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects revoked or expired families without treating them as reuse', async () => {
    const { issued } = await newFamily();
    await sessions.revokeSession(issued.sessionId, SessionRevokeReason.LOGOUT);
    await expect(
      sessions.rotate(issued.refreshToken, meta),
    ).rejects.toMatchObject({ status: 401 });
    const row = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.revokedReason).toBe(SessionRevokeReason.LOGOUT);
  });

  it.each([
    ['blocked', { status: UserStatus.BLOCKED, blockedAt: new Date() }],
    ['archived', { status: UserStatus.ARCHIVED, archivedAt: new Date() }],
    ['demo while demo accounts are disabled', { isDemo: true }],
  ])('rejects rotation for a %s user', async (_label, change) => {
    const { user, issued } = await newFamily();
    await testApp.prisma.user.update({ where: { id: user.id }, data: change });
    await expect(
      sessions.rotate(issued.refreshToken, meta),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('revokeAllForUser revokes every live session except the given one', async () => {
    const { user } = await createUser(testApp.prisma);
    const keep = await sessions.createSession(
      { id: user.id, role: user.role },
      { mfaVerified: false },
    );
    const a = await sessions.createSession(
      { id: user.id, role: user.role },
      { mfaVerified: false },
    );
    const b = await sessions.createSession(
      { id: user.id, role: user.role },
      { mfaVerified: false },
    );

    const revoked = await sessions.revokeAllForUser(
      user.id,
      SessionRevokeReason.PASSWORD_CHANGED,
      {
        exceptSessionId: keep.sessionId,
      },
    );
    expect(revoked).toBe(2);
    const active = await sessions.listActive(user.id);
    expect(active.map((s) => s.id)).toEqual([keep.sessionId]);
    expect(Object.keys(active[0]).sort()).toEqual([
      'createdAt',
      'id',
      'ip',
      'lastUsedAt',
      'userAgent',
    ]);

    for (const id of [a.sessionId, b.sessionId]) {
      const row = await testApp.prisma.session.findUniqueOrThrow({
        where: { id },
      });
      expect(row.revokedReason).toBe(SessionRevokeReason.PASSWORD_CHANGED);
    }
    expect(
      await sessions.revokeAllForUser(user.id, SessionRevokeReason.LOGOUT_ALL),
    ).toBe(1);
    expect(await sessions.listActive(user.id)).toEqual([]);
  });

  it('revokeSession participates in a caller transaction', async () => {
    const { issued } = await newFamily();
    await expect(
      testApp.prisma.$transaction(async (tx) => {
        expect(
          await sessions.revokeSession(
            issued.sessionId,
            SessionRevokeReason.ADMIN_REVOKED,
            tx,
          ),
        ).toBe(true);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const row = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.revokedAt).toBeNull();
  });
});
