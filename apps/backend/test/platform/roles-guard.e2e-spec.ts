import { UserRole } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import { ProbeController } from './support/probe.controller.js';

describe('RolesGuard (fail-closed authorization)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function headerFor(role: UserRole) {
    const { user } = await createUser(testApp.prisma, {
      role,
      mfaEnabled: role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN,
    });
    return (await loginAs(testApp, user)).authHeader;
  }

  it('rejects a route without @Roles/@Public with 403 even for SUPER_ADMIN', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/no-metadata')
      .set(await headerFor(UserRole.SUPER_ADMIN))
      .expect(403);
    expect(res.body).toStrictEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Ruxsat yo‘q',
      requestId: res.headers['x-request-id'],
    });
    expect(res.text).not.toContain('leaked');
  });

  it('requires authentication before authorization (401 without a token)', async () => {
    await testApp.http().get('/api/v1/test-probe/no-metadata').expect(401);
  });

  it('treats a route marked both @Public and @Roles as protected', async () => {
    await testApp.http().get('/api/v1/test-probe/both').expect(401);
    await testApp
      .http()
      .get('/api/v1/test-probe/both')
      .set(await headerFor(UserRole.FARMER))
      .expect(200);
    await testApp
      .http()
      .get('/api/v1/test-probe/both')
      .set(await headerFor(UserRole.VET))
      .expect(403);
  });

  it.each([UserRole.FARMER, UserRole.VET, UserRole.SUPPORT])(
    'denies %s on an ADMIN/SUPER_ADMIN route',
    async (role) => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/admin')
        .set(await headerFor(role))
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    },
  );

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'allows %s (MFA verified)',
    async (role) => {
      await testApp
        .http()
        .get('/api/v1/test-probe/admin')
        .set(await headerFor(role))
        .expect(200);
    },
  );

  it('uses the current DB role: a demoted admin loses access immediately', async () => {
    const { user } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const auth = await loginAs(testApp, user);
    await testApp
      .http()
      .get('/api/v1/test-probe/admin')
      .set(auth.authHeader)
      .expect(200);
    await testApp.prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.FARMER },
    });
    await testApp
      .http()
      .get('/api/v1/test-probe/admin')
      .set(auth.authHeader)
      .expect(403);
    await testApp
      .http()
      .get('/api/v1/test-probe/farmer')
      .set(auth.authHeader)
      .expect(200);
  });

  it('leaves @Public routes open', async () => {
    await testApp.http().get('/api/v1/test-probe/public').expect(200);
  });
});
