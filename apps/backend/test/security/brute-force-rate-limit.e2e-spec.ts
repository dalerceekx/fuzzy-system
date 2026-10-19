import type { Response } from 'supertest';
import { AuditAction } from '../../src/audit/audit-actions.js';
import { maskPhone } from '../../src/common/phone.js';
import { login } from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';

// Per-request values (request id, exact Retry-After seconds) are masked.
const strip = (res: Response) => {
  const { requestId, details, ...body } = res.body as Record<string, unknown>;
  return {
    status: res.status,
    body,
    requestId: typeof requestId,
    details: details ? Object.keys(details) : null,
    retryAfter: typeof res.headers['retry-after'],
  };
};

describe('Security: login brute force — per-account lockout and per-IP limit', () => {
  describe('per-account lockout (LOGIN_MAX_FAILED_ATTEMPTS=5)', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({ features: ['auth'] });
    });

    afterAll(async () => {
      await testApp.close();
    });

    // Every attempt from a different IP: only the account limit applies.
    async function hammer(phone: string, attempts: number) {
      const results: Response[] = [];
      for (let i = 0; i < attempts; i++) {
        results.push(await login(testApp, phone, 'Wrong-pass-1'));
      }
      return results;
    }

    it('locks an existing account after 5 failures; the right password is then 429 too', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const failures = await hammer(user.phone, 5);
      expect(failures.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);

      const locked = await login(testApp, user.phone, password).expect(429);
      expect(locked.body).toMatchObject({
        code: 'ACCOUNT_LOCKED',
        message: 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring',
      });
      const retryAfter = Number(locked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(900);
      expect(
        await testApp.prisma.session.count({ where: { userId: user.id } }),
      ).toBe(0);

      const failedAudits = await testApp.prisma.auditLog.findMany({
        where: { action: AuditAction.AUTH_LOGIN_FAILED, resourceId: user.id },
      });
      expect(failedAudits).toHaveLength(5);
      expect(failedAudits[0].newValue).toEqual({
        phoneMasked: maskPhone(user.phone),
        reason: 'invalid_password',
      });
      expect(JSON.stringify(failedAudits)).not.toContain('Wrong-pass-1');
      expect(JSON.stringify(failedAudits)).not.toContain(user.phone);
      expect(
        await testApp.prisma.auditLog.count({
          where: {
            action: AuditAction.AUTH_LOGIN_LOCKED,
            newValue: { equals: { phoneMasked: maskPhone(user.phone) } },
          },
        }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('a parallel burst cannot try more than 5 passwords', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const burst = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          login(testApp, user.phone, `Wrong-pass-${i}`),
        ),
      );
      const statuses = burst.map((res) => res.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(15);
      await login(testApp, user.phone, password).expect(429);
      expect(
        await testApp.prisma.session.count({ where: { userId: user.id } }),
      ).toBe(0);
    });

    it('an unknown phone is locked the same way, with identical responses', async () => {
      const { user } = await createUser(testApp.prisma);
      const unknown = await uniquePhone();
      // Masked phones can collide with rows of earlier runs: scope by time.
      const since = new Date();
      const known = await hammer(user.phone, 6);
      const ghost = await hammer(unknown, 6);
      expect(ghost.map(strip)).toEqual(known.map(strip));
      expect(ghost.map((r) => r.status)).toEqual([
        401, 401, 401, 401, 401, 429,
      ]);
      expect(ghost[5].headers['retry-after']).toBeDefined();
      expect(
        await testApp.prisma.auditLog.count({
          where: {
            action: AuditAction.AUTH_LOGIN_FAILED,
            timestamp: { gte: since },
            resourceId: null,
            actorId: null,
            newValue: {
              equals: {
                phoneMasked: maskPhone(unknown),
                reason: 'unknown_phone',
              },
            },
          },
        }),
      ).toBe(5);
    });

    it('a successful login resets the failure counter', async () => {
      const { user, password } = await createUser(testApp.prisma);
      await hammer(user.phone, 4);
      await login(testApp, user.phone, password).expect(200);
      const after = await hammer(user.phone, 4);
      expect(after.map((r) => r.status)).toEqual([401, 401, 401, 401]);
      await login(testApp, user.phone, password).expect(200);
    });
  });

  describe('lockout expiry (LOGIN_LOCKOUT_SECONDS=1)', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({
        features: ['auth'],
        env: { LOGIN_LOCKOUT_SECONDS: '1', LOGIN_MAX_FAILED_ATTEMPTS: '2' },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('the lock is temporary', async () => {
      const { user, password } = await createUser(testApp.prisma);
      await login(testApp, user.phone, 'Wrong-pass-1').expect(401);
      await login(testApp, user.phone, 'Wrong-pass-1').expect(401);
      await login(testApp, user.phone, password).expect(429);
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await login(testApp, user.phone, password).expect(200);
    });
  });

  describe('per-IP limit (LOGIN_RATE_LIMIT_PER_IP=5)', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({
        features: ['auth'],
        env: { LOGIN_RATE_LIMIT_PER_IP: '5' },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('one IP spraying many phones gets 429 RATE_LIMITED; other IPs are unaffected', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 5; i++) {
        await login(testApp, await uniquePhone(), 'Wrong-pass-1', {
          ip,
        }).expect(401);
      }
      const limited = await login(testApp, await uniquePhone(), 'x1', {
        ip,
      }).expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      // Even valid credentials from the limited IP are refused …
      const { user, password } = await createUser(testApp.prisma);
      await login(testApp, user.phone, password, { ip }).expect(429);
      // … while the same account logs in fine from another IP.
      await login(testApp, user.phone, password, { ip: uniqueIp() }).expect(
        200,
      );
    });
  });
});
