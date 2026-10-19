import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController } from './support/probe.controller.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Request id', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('generates a UUID v4 when none is sent and exposes it in the context', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .expect(200);
    const id = res.headers['x-request-id'];
    expect(id).toMatch(UUID_V4);
    expect(res.body.context.requestId).toBe(id);
  });

  it('accepts a well-formed inbound X-Request-Id from the trusted proxy', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Request-Id', 'edge-proxy_trace.0001')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('edge-proxy_trace.0001');
    expect(res.body.context.requestId).toBe('edge-proxy_trace.0001');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['illegal characters', 'id with spaces!'],
    // Real CR/LF cannot pass Node's header validation; the sanitizer's
    // handling of it is unit-tested in request-id.spec.ts.
    ['backslash escape sequence', 'abcdefgh\\nlevel=error'],
    ['json breaking', 'abcdefgh","admin":"true'],
  ])('replaces an invalid inbound id (%s)', async (_label, value) => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Request-Id', value)
      .expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
    expect(res.headers['x-request-id']).not.toBe(value);
  });

  it('puts the same id into every error body', async () => {
    const notFound = await testApp
      .http()
      .get('/api/v1/nope')
      .set('X-Request-Id', 'trace-404-0001')
      .expect(404);
    expect(notFound.body.requestId).toBe('trace-404-0001');
    expect(notFound.headers['x-request-id']).toBe('trace-404-0001');

    const unauthorized = await testApp
      .http()
      .get('/api/v1/test-probe/me')
      .expect(401);
    expect(unauthorized.body.requestId).toBe(
      unauthorized.headers['x-request-id'],
    );

    const badJson = await testApp
      .http()
      .post('/api/v1/test-probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);
    expect(badJson.body.requestId).toBe(badJson.headers['x-request-id']);
  });

  it('records the client IP from X-Forwarded-For sent by the trusted proxy', async () => {
    const res = await testApp
      .http()
      .get('/api/v1/test-probe/public')
      .set('X-Forwarded-For', '203.0.113.7')
      .set('User-Agent', 'request-id-test/1.0')
      .expect(200);
    expect(res.body.context).toMatchObject({
      ip: '203.0.113.7',
      userAgent: 'request-id-test/1.0',
    });
  });

  describe('without a trusted proxy (TRUST_PROXY=false)', () => {
    let direct: TestApp;

    beforeAll(async () => {
      direct = await createTestApp({
        controllers: [ProbeController],
        env: { TRUST_PROXY: 'false' },
      });
    });

    afterAll(async () => {
      await direct.close();
    });

    it('ignores a spoofed X-Forwarded-For (the socket address is used)', async () => {
      const res = await direct
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(200);
      expect(res.body.context.ip).not.toBe('198.51.100.1');
      expect(res.body.context.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    });

    it('ignores a client-chosen X-Request-Id (it would land in audit rows)', async () => {
      const res = await direct
        .http()
        .get('/api/v1/test-probe/public')
        .set('X-Request-Id', 'AAAAAAAA')
        .expect(200);
      expect(res.headers['x-request-id']).toMatch(UUID_V4);
      expect(res.body.context.requestId).toBe(res.headers['x-request-id']);
    });
  });
});
