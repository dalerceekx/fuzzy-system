import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Dev-only switches. A production bundle must never contain demo
// credentials or the in-browser mock backend, so the build refuses to run
// when any of them is configured for production.
const DEV_ONLY_ENV = [
  'VITE_ENABLE_MOCK',
  'VITE_SHOW_DEMO_ACCOUNTS',
  'VITE_DEMO_SUPER_ADMIN_PHONE',
  'VITE_DEMO_SUPER_ADMIN_PASSWORD',
  'VITE_DEMO_FARMER_PHONE',
  'VITE_DEMO_FARMER_PASSWORD',
] as const;

function assertNoDevOnlyEnv(env: Record<string, string>): void {
  const offending = DEV_ONLY_ENV.filter((name) => {
    const value = env[name]?.trim();
    return value !== undefined && value !== '' && value !== 'false';
  });
  if (offending.length > 0) {
    throw new Error(
      `Production build to‘xtatildi: ${offending.join(', ')} faqat development uchun. ` +
        'Ularni .env.development.local fayliga ko‘chiring.',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && mode === 'production') assertNoDevOnlyEnv(env);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { sourcemap: false, target: 'es2022' },
    test: {
      environment: 'jsdom',
      // Each DOM worker loads the application's lazy routes. Bound concurrency
      // so the normal test command also works alongside the local Docker stack.
      maxWorkers: 2,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
      // Tests never talk to a real backend; the mock backend is wired in
      // per test through the HTTP client's adapter.
      env: { VITE_API_BASE_URL: 'http://api.test/api/v1' },
    },
  };
});
