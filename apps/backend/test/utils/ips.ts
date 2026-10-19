import { Redis } from 'ioredis';

/** Redis counter giving each test file of a run its own 10.<block>.0.0/16. */
export const IP_BLOCK_SEQUENCE_KEY = 'test:seq:ip-block';

const MAX_BLOCKS = 250;
const ADDRESSES_PER_BLOCK = 250 * 250;

let block: number | undefined;
let counter = 0;

/**
 * Reserves this file's IP block (Redis INCR, unique across every file of the
 * run; the global setup FLUSHDBs the counter). Called once per file by
 * test/setup/per-file.ts before any test runs.
 */
export async function reserveIpBlock(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  try {
    const n = await redis.incr(IP_BLOCK_SEQUENCE_KEY);
    if (n > MAX_BLOCKS) {
      throw new Error('Test IP blocks exhausted (more than 250 test files)');
    }
    block = n;
    counter = 0;
  } finally {
    redis.disconnect();
  }
}

/**
 * A client IP (10.<block>.<x>.<y>) that no other test of the whole run uses.
 * Send it as X-Forwarded-For (the test env trusts the loopback proxy) to
 * isolate per-IP buckets: global rate limit, login, SMS quotas. Requests
 * without X-Forwarded-For all share 127.0.0.1 for the whole run, so any test
 * that depends on a low per-IP limit must use this helper.
 */
export function uniqueIp(): string {
  if (block === undefined) {
    throw new Error('uniqueIp() needs reserveIpBlock() (e2e per-file setup)');
  }
  if (counter >= ADDRESSES_PER_BLOCK) {
    throw new Error('Test IP space for this file exhausted');
  }
  const n = counter;
  counter += 1;
  return `10.${block}.${Math.floor(n / 250) + 1}.${(n % 250) + 1}`;
}
