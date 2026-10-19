import {
  STORAGE_DRIVER,
  type StorageDriver,
} from '../../src/storage/storage.types.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { uniqueIp } from '../utils/ips.js';

describe('Health endpoints', () => {
  describe('with all dependencies up', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      // A tiny global limit proves /health is exempt from it.
      testApp = await createTestApp({
        env: { RATE_LIMIT_GLOBAL_PER_MINUTE: '1' },
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('GET /api/v1/health → 200 with up/down strings only', async () => {
      const res = await testApp.http().get('/api/v1/health').expect(200);
      expect(res.body).toStrictEqual({
        status: 'ok',
        checks: { database: 'up', redis: 'up', storage: 'up' },
      });
    });

    it('GET /api/v1/health/live → 200 without dependency checks', async () => {
      const res = await testApp.http().get('/api/v1/health/live').expect(200);
      expect(res.body).toStrictEqual({ status: 'ok' });
    });

    it('is public and exempt from the global rate limit', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 5; i += 1) {
        await testApp
          .http()
          .get('/api/v1/health/live')
          .set('X-Forwarded-For', ip)
          .expect(200);
      }
    });

    it('is never written to the access log', async () => {
      const logs = captureLogs();
      await testApp.http().get('/api/v1/health').expect(200);
      await testApp.http().get('/api/v1/health/live').expect(200);
      // Positive control: a normal request in the same window IS logged.
      await testApp.http().get('/api/v1').set('X-Forwarded-For', uniqueIp());
      await flushLogs();
      logs.stop();
      expect(logs.text()).not.toContain('/api/v1/health');
      expect(logs.json().some((line) => line.path === '/api/v1')).toBe(true);
    });
  });

  describe('dependency probes under load', () => {
    let testApp: TestApp;
    let storageChecks = 0;
    const countingStorage: StorageDriver = {
      kind: 'local',
      put: () => Promise.reject(new Error('unused')),
      getStream: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
      getSignedDownloadUrl: () => Promise.resolve(null),
      healthCheck: async () => {
        storageChecks += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    };

    beforeAll(async () => {
      testApp = await createTestApp({
        configure: (builder) =>
          builder.overrideProvider(STORAGE_DRIVER).useValue(countingStorage),
      });
      // One real listener shared by all concurrent supertest requests.
      await testApp.app.listen(0, '127.0.0.1');
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('shares one in-flight probe and caches it, so a flood costs one check', async () => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => testApp.http().get('/api/v1/health')),
      );
      for (let i = 0; i < 10; i += 1) {
        responses.push(await testApp.http().get('/api/v1/health'));
      }
      expect(responses.every((res) => res.status === 200)).toBe(true);
      expect(storageChecks).toBe(1);
    });
  });

  describe('with a failing dependency', () => {
    let testApp: TestApp;
    const failingStorage: StorageDriver = {
      kind: 'local',
      put: () => Promise.reject(new Error('unused')),
      getStream: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
      getSignedDownloadUrl: () => Promise.resolve(null),
      healthCheck: () =>
        Promise.reject(
          new Error('EACCES /var/secret/uploads password=hunter2'),
        ),
    };

    beforeAll(async () => {
      testApp = await createTestApp({
        configure: (builder) =>
          builder.overrideProvider(STORAGE_DRIVER).useValue(failingStorage),
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('→ 503 with "down" and no error details', async () => {
      const res = await testApp.http().get('/api/v1/health').expect(503);
      expect(res.body).toStrictEqual({
        status: 'error',
        checks: { database: 'up', redis: 'up', storage: 'down' },
      });
      expect(res.text).not.toMatch(/EACCES|secret|hunter2|uploads/);
    });

    it('liveness stays up', async () => {
      await testApp.http().get('/api/v1/health/live').expect(200);
    });
  });
});
