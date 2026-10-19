import type { Response } from 'supertest';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import {
  actorWithRole,
  AUDIT_LOGS_URL,
  USERS_URL,
  type Actor,
} from '../users/support.js';

const SECRET_KEYS = [
  'passwordHash',
  'mfaSecretEnc',
  'mfaPendingSecretEnc',
  'mfaLastUsedStep',
];

describe('Admin API responses never contain secret user fields', () => {
  let testApp: TestApp;
  let superAdmin: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['users'] });
    superAdmin = await actorWithRole(testApp, UserRole.SUPER_ADMIN);
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** A user with every secret column populated. */
  async function userWithSecrets(role: UserRole = UserRole.FARMER) {
    const { user } = await createUser(testApp.prisma, {
      role,
      mfaEnabled: true,
    });
    const stored = await testApp.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaPendingSecretEnc: user.mfaSecretEnc,
        mfaLastUsedStep: 58_000_000,
      },
    });
    await loginAs(testApp, stored);
    return stored;
  }

  function expectNoSecrets(
    res: Response,
    secrets: { passwordHash: string; mfaSecretEnc: string | null },
  ) {
    const text = res.text;
    for (const key of SECRET_KEYS) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('scrypt$');
    expect(text).not.toContain(secrets.passwordHash);
    if (secrets.mfaSecretEnc) expect(text).not.toContain(secrets.mfaSecretEnc);
  }

  it('list and detail', async () => {
    const target = await userWithSecrets();
    const list = await testApp
      .http()
      .get(USERS_URL)
      .query({ phone: target.phone })
      .set(superAdmin.auth.authHeader)
      .expect(200);
    expect(list.body.total).toBe(1);
    expectNoSecrets(list, target);

    const detail = await testApp
      .http()
      .get(`${USERS_URL}/${target.id}`)
      .set(superAdmin.auth.authHeader)
      .expect(200);
    expectNoSecrets(detail, target);
  });

  it.each([
    ['role change', 'patch', 'role', { role: UserRole.VET }],
    ['block', 'post', 'block', { reason: 'Sinov' }],
    ['archive', 'post', 'archive', { reason: 'Sinov' }],
    ['MFA reset', 'post', 'mfa/reset', undefined],
    ['session revocation', 'post', 'sessions/revoke', undefined],
  ] as const)('%s', async (_name, method, path, body) => {
    const target = await userWithSecrets(UserRole.ADMIN);
    const res = await testApp
      .http()
      [method](`${USERS_URL}/${target.id}/${path}`)
      .set(superAdmin.auth.authHeader)
      .send(body)
      .expect(200);
    expectNoSecrets(res, target);
  });

  it('unblock', async () => {
    const target = await userWithSecrets();
    await testApp
      .http()
      .post(`${USERS_URL}/${target.id}/block`)
      .set(superAdmin.auth.authHeader)
      .send({ reason: 'Sinov' })
      .expect(200);
    const res = await testApp
      .http()
      .post(`${USERS_URL}/${target.id}/unblock`)
      .set(superAdmin.auth.authHeader)
      .expect(200);
    expectNoSecrets(res, target);
  });

  it('create: the response and the audit row hold neither the password nor its hash', async () => {
    const password = 'Created-secret-2026';
    const res = await testApp
      .http()
      .post(USERS_URL)
      .set(superAdmin.auth.authHeader)
      .send({
        phone: await uniquePhone(),
        fullName: 'Yangi xodim',
        role: UserRole.SUPPORT,
        password,
      })
      .expect(201);
    const stored = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expectNoSecrets(res, stored);
    expect(res.text).not.toContain(password);

    const audit = await testApp
      .http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId: stored.id })
      .set(superAdmin.auth.authHeader)
      .expect(200);
    expect(audit.body.total).toBe(1);
    expectNoSecrets(audit, stored);
    expect(audit.text).not.toContain(password);
  });

  it('validation errors do not echo the submitted password', async () => {
    const password = 'onlyletters-no-digits';
    const res = await testApp
      .http()
      .post(USERS_URL)
      .set(superAdmin.auth.authHeader)
      .send({
        phone: await uniquePhone(),
        fullName: 'Xodim',
        role: UserRole.VET,
        password,
      })
      .expect(400);
    expect(res.text).not.toContain(password);
  });
});
