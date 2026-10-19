import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database or Redis.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});
