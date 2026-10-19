import type { Response } from 'supertest';
import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController } from './support/probe.controller.js';
import { PRODUCTION_ENV } from './support/production-env.js';

const API_CSP =
  "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'";

function expectHardenedHeaders(res: Response): void {
  expect(res.headers['content-security-policy']).toBe(API_CSP);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
  expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['x-powered-by']).toBeUndefined();
}

describe('Security headers', () => {
  describe('development/test configuration', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({ controllers: [ProbeController] });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('are set on successful API responses, without HSTS', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .expect(200);
      expectHardenedHeaders(res);
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    it('are set on error responses too', async () => {
      expectHardenedHeaders(
        await testApp.http().get('/api/v1/missing').expect(404),
      );
      expectHardenedHeaders(
        await testApp.http().get('/api/v1/test-probe/me').expect(401),
      );
      expectHardenedHeaders(
        await testApp
          .http()
          .post('/api/v1/test-probe/echo')
          .send({ name: 'x'.repeat(200_000) })
          .expect(413),
      );
    });

    it('Swagger is disabled by default (SWAGGER_ENABLED unset)', async () => {
      // The test env sets SWAGGER_ENABLED=false; unset it to hit the schema default.
      const defaults = await createTestApp({
        env: { SWAGGER_ENABLED: undefined },
      });
      try {
        await defaults.http().get('/docs').expect(404);
        await defaults.http().get('/docs-json').expect(404);
      } finally {
        await defaults.close();
      }
    });
  });

  describe('production behind an HTTPS proxy', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      // HTTPS_REQUIRED unset: HTTPS enforcement and HSTS must come from the
      // production default, not from an explicit setting.
      testApp = await createTestApp({
        controllers: [ProbeController],
        env: { ...PRODUCTION_ENV, HTTPS_REQUIRED: undefined },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('sends HSTS with includeSubDomains', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      expect(res.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expectHardenedHeaders(res);
    });

    it('rejects plain HTTP with 403 HTTPS_REQUIRED (HTTPS is the default in production)', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .expect(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        code: 'HTTPS_REQUIRED',
      });
    });
  });

  describe('Swagger when explicitly enabled', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({ env: { SWAGGER_ENABLED: 'true' } });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('serves the UI with its own relaxed CSP (API keeps the strict one)', async () => {
      const docs = await testApp.http().get('/docs').redirects(1);
      expect(docs.status).toBe(200);
      expect(docs.headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      expect(docs.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );

      const api = await testApp.http().get('/api/v1').expect(200);
      expect(api.headers['content-security-policy']).toBe(API_CSP);
    });
  });
});
