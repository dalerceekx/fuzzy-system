// Dev talks to the local backend; a production bundle defaults to the same
// origin (reverse proxy: / → SPA, /api/v1 → API), never to localhost.
const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:3001/api/v1' : '/api/v1';

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Runtime configuration. Only public values live here — the browser bundle
 * never receives backend secrets. `import.meta.env.DEV` is a build-time
 * constant, so dev-only switches are statically false in production builds.
 */
export const env = {
  apiBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL),
  isDev: import.meta.env.DEV,
  mockEnabled: import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true',
  showDemoAccounts: import.meta.env.DEV && import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true',
} as const;
