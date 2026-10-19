export interface TestTargets {
  databaseUrl: string;
  databaseName: string;
  redisUrl: string;
  redisDb: number;
}

/** `<name>_test` or `<name>_test_<suffix>` (lowercase, digits, `_`). */
export const TEST_DATABASE_NAME = /^[a-z0-9_]+_test(_[a-z0-9]+)?$/;

// Connection-string parameters that cannot redirect to another database.
const SAFE_DATABASE_PARAMS = new Set([
  'schema',
  'sslmode',
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'application_name',
]);

/**
 * Reads TEST_DATABASE_URL / TEST_REDIS_URL and refuses anything that does
 * not look like a disposable test target: the database name must match
 * TEST_DATABASE_NAME (no other query parameter may pick a different
 * host/database) and Redis must select a non-zero DB index in its path,
 * with no query string (ioredis would let `?db=0` override the path).
 */
export function resolveTestTargets(
  env: NodeJS.ProcessEnv = process.env,
): TestTargets {
  const databaseUrl = env.TEST_DATABASE_URL;
  const redisUrl = env.TEST_REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'E2E tests need TEST_DATABASE_URL (database name containing "_test") and ' +
        'TEST_REDIS_URL (non-zero DB index), e.g. ' +
        'TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/meningfermam_test ' +
        'TEST_REDIS_URL=redis://127.0.0.1:6379/1',
    );
  }

  const database = new URL(databaseUrl);
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Refusing to run: database "${databaseName}" is not a <name>_test[_<suffix>] database`,
    );
  }
  for (const param of database.searchParams.keys()) {
    if (!SAFE_DATABASE_PARAMS.has(param)) {
      throw new Error(
        `Refusing to run: TEST_DATABASE_URL parameter "${param}" is not allowed`,
      );
    }
  }

  const redis = new URL(redisUrl);
  const redisPath = redis.pathname.replace(/^\//, '');
  if (
    !/^[1-9]\d?$/.test(redisPath) ||
    redis.search !== '' ||
    redis.hash !== ''
  ) {
    throw new Error(
      'Refusing to run: TEST_REDIS_URL must select a non-zero Redis DB index ' +
        '(redis://host:port/<n>, no query string)',
    );
  }
  const redisDb = Number(redisPath);
  return { databaseUrl, databaseName, redisUrl, redisDb };
}
