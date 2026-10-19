import { afterAll } from 'vitest';
import { setLogDestination } from '../../src/logging/log-destination.js';
import { closeFactoryConnections } from '../utils/factories.js';
import { reserveIpBlock } from '../utils/ips.js';

// Application logs are discarded unless a test captures them
// (test/utils/logs.ts) or TEST_LOGS=stdout is set.
if (process.env.TEST_LOGS !== 'stdout') {
  setLogDestination({ write: () => undefined });
}

// Each file gets its own X-Forwarded-For range for uniqueIp().
await reserveIpBlock(process.env.REDIS_URL ?? '');

afterAll(async () => {
  await closeFactoryConnections();
});
