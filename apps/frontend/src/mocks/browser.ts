/**
 * DEVELOPMENT ONLY — installed by main.tsx when VITE_ENABLE_MOCK=true in a
 * dev build. The UI shows a permanent "Namuna rejimi" banner. Mock state is
 * kept in sessionStorage so a page reload keeps the mock session; the real
 * API is never contacted while this is active.
 */
import { http } from '@/shared/api/client';
import { createMockAdapter } from './adapter';
import { createSeedDb, type MockDb } from './db';
import { createMockServer } from './server';

const STORAGE_KEY = 'mf-mock-db';

function loadDb(): MockDb {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    // A copy saved before the rations tables existed starts from the seed.
    const parsed = saved ? (JSON.parse(saved) as Partial<MockDb>) : null;
    if (parsed && Array.isArray(parsed.rations)) return parsed as MockDb;
  } catch {
    // Corrupt or unavailable storage: start from the seed.
  }
  return createSeedDb();
}

function syncCsrfCookie(db: MockDb): void {
  // Mirrors the backend's JS-readable CSRF cookie (mf_csrf, Path=/).
  document.cookie = db.csrfToken
    ? `mf_csrf=${encodeURIComponent(db.csrfToken)}; path=/; SameSite=Strict`
    : 'mf_csrf=; path=/; max-age=0';
}

export function installMockBackend(): void {
  const server = createMockServer(loadDb());
  const adapter = createMockAdapter(server, { latencyMs: 250 });
  http.defaults.adapter = async (config) => {
    try {
      return await adapter(config);
    } finally {
      syncCsrfCookie(server.db);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(server.db));
      } catch {
        // ignore quota errors in mock mode
      }
    }
  };
  syncCsrfCookie(server.db);
  console.warn('[MeningFermam] Namuna rejimi yoqilgan: so‘rovlar backend’ga yuborilmaydi.');
}
