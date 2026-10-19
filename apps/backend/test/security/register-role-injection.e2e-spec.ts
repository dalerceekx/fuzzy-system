import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { AUTH, settle, STRONG_PASSWORD } from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';

/**
 * Registration can only ever create a FARMER in PENDING_VERIFICATION: any
 * attempt to choose role, status, demo flag, MFA state or ids is rejected by
 * the whitelist (400) before anything is written or sent.
 */
describe('Security: role injection through /auth/register', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const injected: Array<[string, Record<string, unknown>]> = [
    ['role SUPER_ADMIN', { role: UserRole.SUPER_ADMIN }],
    ['role ADMIN', { role: UserRole.ADMIN }],
    ['role VET (lower case)', { role: 'vet' }],
    ['status ACTIVE', { status: UserStatus.ACTIVE }],
    ['isDemo', { isDemo: true }],
    ['mfaEnabled', { mfaEnabled: true }],
    ['phoneVerifiedAt', { phoneVerifiedAt: new Date().toISOString() }],
    ['id', { id: crypto.randomUUID() }],
    ['passwordHash', { passwordHash: 'scrypt$1024$8$1$00$00' }],
    ['nested user.role', { user: { role: UserRole.SUPER_ADMIN } }],
  ];

  it.each(injected)(
    '%s → 400 and nothing is created or sent',
    async (_, extra) => {
      const phone = await uniquePhone();
      testApp.sms.clear();
      const res = await testApp
        .http()
        .post(`${AUTH}/register`)
        .set('X-Forwarded-For', uniqueIp())
        .send({
          phone,
          fullName: 'Ali Valiyev',
          password: STRONG_PASSWORD,
          ...extra,
        })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: ['Ruxsat etilmagan maydon yuborildi'],
      });
      expect(await testApp.prisma.user.count({ where: { phone } })).toBe(0);
      expect(await testApp.prisma.otpCode.count({ where: { phone } })).toBe(0);
      expect(testApp.sms.lastTo(phone)).toBeUndefined();
    },
  );

  it('a __proto__ payload cannot smuggle a role either', async () => {
    const phone = await uniquePhone();
    const res = await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'application/json')
      .send(
        `{"phone":"${phone}","fullName":"Ali Valiyev","password":"${STRONG_PASSWORD}","__proto__":{"role":"SUPER_ADMIN"}}`,
      );
    // Either rejected outright or registered as a plain FARMER — never more.
    expect([202, 400]).toContain(res.status);
    await settle(testApp);
    const user = await testApp.prisma.user.findUnique({ where: { phone } });
    if (user) {
      expect(user).toMatchObject({
        role: UserRole.FARMER,
        status: UserStatus.PENDING_VERIFICATION,
        isDemo: false,
      });
    }
  });

  it('a normal registration yields FARMER + PENDING_VERIFICATION, not demo, no MFA', async () => {
    const phone = await uniquePhone();
    await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, fullName: 'Ali Valiyev', password: STRONG_PASSWORD })
      .expect(202);
    await settle(testApp);
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user).toMatchObject({
      role: UserRole.FARMER,
      status: UserStatus.PENDING_VERIFICATION,
      isDemo: false,
      mfaEnabled: false,
      phoneVerifiedAt: null,
    });
  });

  it('a demo-prefix phone can never be registered', async () => {
    const res = await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        phone: '+998000000777',
        fullName: 'Ali Valiyev',
        password: STRONG_PASSWORD,
      })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(
      await testApp.prisma.user.count({ where: { phone: '+998000000777' } }),
    ).toBe(0);
  });
});
