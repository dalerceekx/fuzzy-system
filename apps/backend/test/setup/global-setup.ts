import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PHONE_PREFIX, PHONE_SEQUENCE_KEY } from '../utils/phone-sequence.js';
import { resolveTestTargets } from './test-targets.js';

export const RUN_LOCK_KEY = 'test:run-lock';
const RUN_LOCK_TTL_SECONDS = 120;
const RUN_LOCK_REFRESH_MS = 30_000;

// Atomic: take the run lock and wipe the DB only if no other run holds it,
// then re-create the lock (FLUSHDB removed it) in the same script.
const ACQUIRE_AND_FLUSH = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  redis.call('FLUSHDB')
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
`;
const REFRESH = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Runs once per e2e run (main process):
 * 1. refuses non-test targets;
 * 2. takes a run lock on the test Redis DB (refreshed while the run lasts,
 *    expires 2 minutes after a crash) and fails fast if another run on the
 *    same targets holds it: a second run would FLUSHDB the first run's
 *    rate-limit/lock keys and re-seed the phone counter below numbers
 *    already handed out. One run per TEST_DATABASE_URL/TEST_REDIS_URL;
 * 3. brings the schema up to date with `prisma migrate deploy` (both
 *    DATABASE_URL and MIGRATION_DATABASE_URL forced to the test database,
 *    so a .env can never redirect it). The database is NOT wiped between
 *    runs: tests must scope every assertion to rows they created (by id or
 *    unique phone) and never assert global counts or empty tables.
 *    TEST_DB_RESET=true runs `prisma migrate reset --force` instead — for a
 *    human or CI only: Prisma refuses it without explicit user consent when
 *    an AI agent runs it;
 * 4. FLUSHDB on the test Redis DB (inside the lock script);
 * 5. seeds the unique-phone counter past every phone already stored.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const targets = resolveTestTargets();
  const lockToken = `${process.pid}:${randomUUID()}`;
  const redis = new Redis(targets.redisUrl, { maxRetriesPerRequest: 1 });
  const acquired = await redis.eval(
    ACQUIRE_AND_FLUSH,
    1,
    RUN_LOCK_KEY,
    lockToken,
    String(RUN_LOCK_TTL_SECONDS),
  );
  if (acquired !== 1) {
    const holder = await redis.get(RUN_LOCK_KEY);
    redis.disconnect();
    throw new Error(
      `Another e2e run (${holder ?? 'unknown'}) is using ${targets.databaseName} / ` +
        `Redis DB ${targets.redisDb}. Wait for it to finish (the lock expires ` +
        `${RUN_LOCK_TTL_SECONDS}s after a crashed run).`,
    );
  }
  const heartbeat = setInterval(() => {
    void redis
      .eval(REFRESH, 1, RUN_LOCK_KEY, lockToken, String(RUN_LOCK_TTL_SECONDS))
      .catch(() => undefined);
  }, RUN_LOCK_REFRESH_MS);
  heartbeat.unref();

  const teardown = async (): Promise<void> => {
    clearInterval(heartbeat);
    await redis.eval(RELEASE, 1, RUN_LOCK_KEY, lockToken).catch(() => 0);
    redis.disconnect();
  };

  try {
    migrate(targets.databaseUrl, targets.databaseName);
    await seedPhoneSequence(targets.databaseUrl, redis);
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}

function migrate(databaseUrl: string, databaseName: string): void {
  const reset = process.env.TEST_DB_RESET === 'true';
  // Resolved through Node so it works when npm workspaces hoist the CLI to
  // the monorepo root node_modules.
  const prismaCli = createRequire(import.meta.url).resolve(
    'prisma/build/index.js',
  );
  const args = reset ? ['migrate', 'reset', '--force'] : ['migrate', 'deploy'];
  try {
    execFileSync(process.execPath, [prismaCli, ...args], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: databaseUrl,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    const output = err as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(
      `${output.stdout?.toString() ?? ''}${output.stderr?.toString() ?? ''}`,
    );
    throw new Error(`prisma ${args.join(' ')} failed for ${databaseName}`);
  }
}

async function seedPhoneSequence(
  databaseUrl: string,
  redis: Redis,
): Promise<void> {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const rows = await db.$queryRaw<Array<{ phone: string | null }>>`
      SELECT max(phone) AS phone FROM users WHERE phone LIKE ${`${PHONE_PREFIX}%`}`;
    const phone = rows[0]?.phone;
    const highest = phone ? Number(phone.slice(PHONE_PREFIX.length)) : 0;
    await redis.set(PHONE_SEQUENCE_KEY, String(highest));
  } finally {
    await db.$disconnect();
  }
}
