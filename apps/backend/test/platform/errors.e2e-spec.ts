import { createTestApp, type TestApp } from '../utils/app.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { ProbeController } from './support/probe.controller.js';

const LEAK_PATTERNS = [
  /\bat .*\.(?:ts|js):\d+/, // stack frames
  /\/Users\/|\/home\/|node_modules|\/etc\/passwd/, // file paths
  /SELECT|INSERT|UPDATE|Failing row|violates|constraint "/i, // SQL / DETAIL
  /scrypt\$|secret-hash|cafebabe/, // the password hash used by the probe
  /Prisma|DriverAdapter|P20\d\d/, // driver internals
];

function expectNoLeak(text: string): void {
  for (const pattern of LEAK_PATTERNS) expect(text).not.toMatch(pattern);
}

describe('Error responses', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('request body', () => {
    it('rejects JSON above BODY_LIMIT with 413 PAYLOAD_TOO_LARGE', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 'x'.repeat(150 * 1024) })
        .expect(413);
      expect(res.body).toStrictEqual({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'So‘rov hajmi juda katta',
        requestId: res.headers['x-request-id'],
      });
    });

    it('rejects urlencoded bodies above BODY_LIMIT too', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .type('form')
        .send(`name=${'y'.repeat(150 * 1024)}`)
        .expect(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('applies the limit even to unknown routes (parsing happens first)', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/does-not-exist')
        .send({ blob: 'z'.repeat(150 * 1024) })
        .expect(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('maps malformed JSON to 400 INVALID_JSON without the parser message', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .set('Content-Type', 'application/json')
        .send('{"name": "x",')
        .expect(400);
      expect(res.body).toStrictEqual({
        statusCode: 400,
        code: 'INVALID_JSON',
        message: 'JSON formati noto‘g‘ri',
        requestId: res.headers['x-request-id'],
      });
      expect(res.text).not.toMatch(/Unexpected|position|JSON\.parse/);
    });

    it('keeps the exact raw bytes for signature checks (req.rawBody)', async () => {
      const raw = '{"name":"imzo",  "password":"x"}';
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/raw-body')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(200);
      expect(res.body).toStrictEqual({ name: 'imzo', raw });
    });

    it('rejects non-object JSON roots (strict parser)', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .set('Content-Type', 'application/json')
        .send('"just a string"')
        .expect(400);
      expect(res.body.code).toBe('INVALID_JSON');
    });
  });

  describe('validation', () => {
    it('returns 400 VALIDATION_FAILED with messages (unknown fields forbidden)', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 42, role: 'SUPER_ADMIN' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'Ruxsat etilmagan maydon yuborildi',
          'name must be a string',
        ]),
      );
      expect(res.text).not.toContain('SUPER_ADMIN');
    });

    it('never echoes client-chosen property names', async () => {
      const objectBody = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 'x', '<script>alert(1)</script>': 1, evilKey123: 2 })
        .expect(400);
      expect(objectBody.body.message).toStrictEqual([
        'Ruxsat etilmagan maydon yuborildi',
      ]);
      expect(objectBody.text).not.toMatch(/script|evilKey123/);

      const arrayBody = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send([{ name: 'x' }])
        .expect(400);
      expect(arrayBody.body.code).toBe('VALIDATION_FAILED');
      expect(arrayBody.text).not.toContain('property 0');
    });

    it('rejects a missing body', async () => {
      const res = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a non-UUID-v4 id with 400 INVALID_ID', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/id/123')
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'INVALID_ID' });
      await testApp
        .http()
        .get('/api/v1/test-probe/id/0b9a3c3e-8d6a-4a62-b3a5-6a8f1f0c2e11')
        .expect(200);
    });
  });

  describe('routing', () => {
    it.each([
      '/api/v1/nope',
      '/api/v1/test-probe/public/extra',
      '/',
      '/favicon.ico',
      '/admin',
    ])('unknown route %s → 404 JSON without echoing the path', async (path) => {
      const res = await testApp.http().get(`${path}?token=leak-me`).expect(404);
      expect(res.body).toStrictEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Topilmadi',
        requestId: res.headers['x-request-id'],
      });
      expect(res.text).not.toContain('leak-me');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('wrong method on an existing path → 404 JSON', async () => {
      const res = await testApp
        .http()
        .delete('/api/v1/test-probe/public')
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('unexpected errors', () => {
    it('return a generic 500 without stack, path, SQL or message', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/boom')
        .expect(500);
      expect(res.body).toStrictEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Ichki server xatosi',
        requestId: res.headers['x-request-id'],
      });
      expectNoLeak(res.text);
    });

    it('replace a plain HttpException message with the standard one (use Errors.* for custom messages)', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/http-error')
        .expect(400);
      expect(res.body).toStrictEqual({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Noto‘g‘ri so‘rov',
        requestId: res.headers['x-request-id'],
      });
    });

    it('never reflect undecodable path input', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/id/%E0%A4%A')
        .expect(400);
      expect(res.body).toStrictEqual({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Noto‘g‘ri so‘rov',
        requestId: res.headers['x-request-id'],
      });
      expect(res.text).not.toContain('%E0');
    });

    it('render framework 413s (multer file size) with the standard message', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/multer-too-large')
        .expect(413);
      expect(res.body).toStrictEqual({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'So‘rov hajmi juda katta',
        requestId: res.headers['x-request-id'],
      });
    });

    it('set Retry-After for 429 errors', async () => {
      const res = await testApp
        .http()
        .get('/api/v1/test-probe/rate-limited')
        .expect(429);
      expect(res.headers['retry-after']).toBe('42');
      expect(res.body).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: 42 },
      });
    });
  });

  describe('database errors', () => {
    it.each([
      ['unique', 409, 'CONFLICT'],
      ['check', 409, 'CONSTRAINT_VIOLATION'],
      ['raw-check', 409, 'CONSTRAINT_VIOLATION'],
      ['fk', 409, 'CONFLICT'],
      ['append-only', 409, 'CONSTRAINT_VIOLATION'],
      ['not-found', 404, 'NOT_FOUND'],
    ])('%s → %i %s without DB details', async (kind, status, code) => {
      const logs = captureLogs();
      const res = await testApp
        .http()
        .get(`/api/v1/test-probe/db-error?kind=${kind}`)
        .expect(status);
      await flushLogs();
      logs.stop();

      expect(res.body).toMatchObject({
        statusCode: status,
        code,
        requestId: res.headers['x-request-id'],
      });
      expect(Object.keys(res.body).sort()).toEqual([
        'code',
        'message',
        'requestId',
        'statusCode',
      ]);
      expectNoLeak(res.text);

      // Server-side logs carry codes only — never the message/DETAIL, which
      // for the check violation contains the whole row incl. the hash.
      const dbLine = logs.json().find((line) => line.db !== undefined);
      expect(dbLine?.db).toBeDefined();
      expect(logs.text()).not.toMatch(
        /Failing row|scrypt\$|secret-hash|violates|duplicate key/,
      );
    });
  });
});
