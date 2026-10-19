import { resolveTestTargets } from './test-targets.js';

const REDIS = 'redis://127.0.0.1:56379/1';
const PG = 'postgresql://u:p@127.0.0.1:55432';

describe('resolveTestTargets', () => {
  it.each([
    `${PG}/meningfermam_test`,
    `${PG}/meningfermam_test_foundation`,
    `${PG}/meningfermam_test_auth?schema=public`,
  ])('accepts %s', (url) => {
    expect(
      resolveTestTargets({ TEST_DATABASE_URL: url, TEST_REDIS_URL: REDIS }),
    ).toMatchObject({ databaseUrl: url, redisUrl: REDIS, redisDb: 1 });
  });

  it.each([
    `${PG}/meningfermam`,
    `${PG}/prod_testimonials`,
    `${PG}/crm_tests_backup`,
    `${PG}/test`,
    `${PG}/meningfermam_TEST`,
    `${PG}/meningfermam_test-x`,
    `${PG}/meningfermam_test?host=prod.example.com`,
    `${PG}/meningfermam_test?dbname=meningfermam`,
  ])('refuses database %s', (url) => {
    expect(() =>
      resolveTestTargets({ TEST_DATABASE_URL: url, TEST_REDIS_URL: REDIS }),
    ).toThrow(/Refusing to run/);
  });

  it.each([
    'redis://127.0.0.1:56379',
    'redis://127.0.0.1:56379/',
    'redis://127.0.0.1:56379/0',
    'redis://127.0.0.1:56379/01',
    'redis://127.0.0.1:56379/1/',
    'redis://127.0.0.1:56379/1?db=0',
    'redis://127.0.0.1:56379/abc',
  ])('refuses Redis %s', (url) => {
    expect(() =>
      resolveTestTargets({
        TEST_DATABASE_URL: `${PG}/meningfermam_test`,
        TEST_REDIS_URL: url,
      }),
    ).toThrow(/Refusing to run/);
  });

  it('requires both variables', () => {
    expect(() => resolveTestTargets({ TEST_REDIS_URL: REDIS })).toThrow(
      /TEST_DATABASE_URL/,
    );
    expect(() =>
      resolveTestTargets({ TEST_DATABASE_URL: `${PG}/meningfermam_test` }),
    ).toThrow(/TEST_REDIS_URL/);
  });
});
