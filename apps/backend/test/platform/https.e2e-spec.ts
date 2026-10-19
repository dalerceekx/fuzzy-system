import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController } from './support/probe.controller.js';
import { PRODUCTION_ENV } from './support/production-env.js';

describe('HTTPS enforcement (HTTPS_REQUIRED=true)', () => {
  describe('behind a trusted proxy (TRUST_PROXY=loopback)', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({
        controllers: [ProbeController],
        env: { HTTPS_REQUIRED: 'true' },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('rejects plain HTTP with 403 HTTPS_REQUIRED', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .expect(403);
      expect(res.body).toStrictEqual({
        statusCode: 403,
        code: 'HTTPS_REQUIRED',
        message: 'Faqat HTTPS orqali ruxsat etiladi',
        requestId: res.headers['x-request-id'],
      });
    });

    it('rejects plain HTTP before reading credentials or bodies', async () => {
      await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .set('Authorization', 'Bearer x.y.z')
        .send({ name: 'x' })
        .expect(403);
    });

    it('accepts requests the proxy marks as HTTPS', async () => {
      await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
    });

    it('lets health probes through over plain HTTP (GET only)', async () => {
      await testApp.http().get('/api/v1/health/live').expect(200);
      await testApp.http().get('/api/v1/health').expect(200);
      await testApp.http().post('/api/v1/health').expect(403);
    });
  });

  describe('with a proxy allowlist that does not include the caller', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      // Requests come from 127.0.0.1, which is not the trusted proxy here.
      testApp = await createTestApp({
        controllers: [ProbeController],
        env: { HTTPS_REQUIRED: 'true', TRUST_PROXY: '192.0.2.10' },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('ignores a spoofed X-Forwarded-Proto', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-Proto', 'https')
        .expect(403);
      expect(res.body.code).toBe('HTTPS_REQUIRED');
    });
  });

  it.each([
    ['no trusted proxy', { HTTPS_REQUIRED: 'true', TRUST_PROXY: 'false' }],
    [
      'production default (TRUST_PROXY unset)',
      { ...PRODUCTION_ENV, TRUST_PROXY: undefined },
    ],
  ])(
    'refuses to start with %s (every request would be 403)',
    async (_l, env) => {
      await expect(createTestApp({ env })).rejects.toThrow(
        /TRUST_PROXY majburiy/,
      );
    },
  );

  it.each(['0.0.0.0/0', '::/0', '100', 'true-ish.example'])(
    'refuses to start with a trust-everyone TRUST_PROXY=%s',
    async (value) => {
      await expect(
        createTestApp({ env: { TRUST_PROXY: value } }),
      ).rejects.toThrow(/TRUST_PROXY/);
    },
  );
});
