import { defineConfig } from 'vitest/config';

// E2E tests boot the real AppModule against PostgreSQL + Redis:
//   TEST_DATABASE_URL=postgresql://…/meningfermam_test_<name> \
//   TEST_REDIS_URL=redis://127.0.0.1:6379/<n> \
//   npx vitest run --config vitest.config.e2e.ts [paths]
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    globalSetup: ['test/setup/global-setup.ts'],
    setupFiles: ['test/setup/env.ts', 'test/setup/per-file.ts'],
    // One shared database: files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
