import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController } from './support/probe.controller.js';
import { uniqueIp } from '../utils/ips.js';

describe('Global per-IP rate limit', () => {
  let testApp: TestApp;
  const LIMIT = 3;

  beforeAll(async () => {
    testApp = await createTestApp({
      controllers: [ProbeController],
      env: { RATE_LIMIT_GLOBAL_PER_MINUTE: String(LIMIT) },
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('answers 429 RATE_LIMITED with Retry-After once the budget is spent', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < LIMIT; i += 1) {
      await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-For', ip)
        .expect(200);
    }
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Forwarded-For', ip)
      .expect(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      requestId: res.headers['x-request-id'],
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('counts per client IP', async () => {
    const [first, second] = [uniqueIp(), uniqueIp()];
    for (let i = 0; i < LIMIT; i += 1) {
      await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-For', first)
        .expect(200);
    }
    await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Forwarded-For', first)
      .expect(429);
    await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Forwarded-For', second)
      .expect(200);
  });

  it('runs before authentication (an anonymous flood gets 429, not 401)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < LIMIT; i += 1) {
      await testApp
        .http()
        .get('/api/v1/test-probe/me')
        .set('X-Forwarded-For', ip)
        .expect(401);
    }
    await testApp
      .http()
      .get('/api/v1/test-probe/me')
      .set('X-Forwarded-For', ip)
      .expect(429);
  });

  it('does not apply to /health (@SkipGlobalRateLimit)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < LIMIT + 3; i += 1) {
      await testApp
        .http()
        .get('/api/v1/health/live')
        .set('X-Forwarded-For', ip)
        .expect(200);
    }
  });

  it('buckets IPv6 clients per /64', async () => {
    const prefix = `2001:db8:${(process.pid % 9000) + 1}:1`;
    for (let i = 0; i < LIMIT; i += 1) {
      await testApp
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-For', `${prefix}::${i + 1}`)
        .expect(200);
    }
    await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Forwarded-For', `${prefix}::ffff`)
      .expect(429);
  });
});
