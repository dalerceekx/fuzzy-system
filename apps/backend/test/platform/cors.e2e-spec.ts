import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController } from './support/probe.controller.js';

const ALLOWED = 'http://localhost:5173';

describe('CORS', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('answers a preflight from an allowlisted origin with that exact origin', async () => {
    const res = await testApp
      .http()
      .options('/api/v1/test-probe/echo')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'Content-Type, Authorization, Idempotency-Key',
      );
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const allowedHeaders = res.headers['access-control-allow-headers'];
    for (const header of [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Client-Type',
    ]) {
      expect(allowedHeaders).toContain(header);
    }
  });

  it('exposes only the documented response headers', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('Origin', ALLOWED)
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-expose-headers']).toBe(
      'X-Request-Id,Retry-After,Idempotent-Replayed',
    );
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it.each([
    'https://evil.example',
    'http://localhost:5174',
    'http://localhost:5173.evil.example',
    'null',
    'HTTP://LOCALHOST:5173',
  ])(
    'never allows %s (no CORS headers, no error, never "*")',
    async (origin) => {
      const preflight = await testApp
        .http()
        .options('/api/v1/test-probe/echo')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.status).toBeLessThan(500);
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        preflight.headers['access-control-allow-credentials'],
      ).toBeUndefined();

      const simple = await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('Origin', origin)
        .expect(200);
      expect(simple.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('does not add CORS headers to same-origin/non-browser requests', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
