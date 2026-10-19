import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '@/shared/config/env';
import { readCookie } from '@/shared/lib/cookies';
import type { PublicUser } from '@/shared/types/api';
import { toApiError } from './errors';
import { accessTokenStore } from './token-store';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Do not attach the access token and do not try to refresh on 401. */
    skipAuth?: boolean;
    /** Internal: set once a request has been replayed after a refresh. */
    replayedAfterRefresh?: boolean;
    /** Internal: the access token the request was sent with. */
    sentWithToken?: string | null;
  }
}

/** Secure (production) and plain (local http) names of the CSRF cookie. */
const CSRF_COOKIE_NAMES = ['__Host-mf_csrf', 'mf_csrf'] as const;
export const CSRF_HEADER = 'X-CSRF-Token';
const REFRESH_LOCK = 'meningfermam:auth-refresh';

export function readCsrfToken(): string | null {
  for (const name of CSRF_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return null;
}

/**
 * The single HTTP client. `withCredentials` lets the browser send the
 * HttpOnly refresh cookie (Path=/api/v1/auth) on auth calls; every other
 * endpoint authenticates with the in-memory Bearer token only.
 */
export const http = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

export interface RefreshedSession {
  accessToken: string;
  /** Present when the backend includes it in the refresh response. */
  user: PublicUser | null;
}

interface RefreshResponse {
  accessToken?: unknown;
  user?: PublicUser;
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/** Fired when the session can no longer be renewed (refresh rejected). */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

/**
 * Serializes refreshes across browser tabs. Refresh tokens rotate and the
 * backend revokes the whole session when an old one is replayed, so two
 * tabs must never send the same refresh cookie concurrently.
 */
async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return task();
  return locks.request(REFRESH_LOCK, task);
}

async function performRefresh(): Promise<RefreshedSession | null> {
  const csrfToken = readCsrfToken();
  // No CSRF cookie → no refresh cookie was ever issued to this browser.
  if (!csrfToken) return null;
  try {
    const { data } = await http.post<RefreshResponse>(
      '/auth/refresh',
      {},
      { skipAuth: true, headers: { [CSRF_HEADER]: csrfToken } },
    );
    if (typeof data.accessToken !== 'string' || data.accessToken.length === 0) return null;
    accessTokenStore.set(data.accessToken);
    return { accessToken: data.accessToken, user: data.user ?? null };
  } catch (error) {
    const apiError = toApiError(error);
    // 401/403 are final (expired, revoked, reused, CSRF). Network and 5xx
    // errors are not: keep the session and let the caller surface them.
    if (apiError.status === 401 || apiError.status === 403) {
      accessTokenStore.clear();
      return null;
    }
    throw apiError;
  }
}

let inflightRefresh: Promise<RefreshedSession | null> | null = null;

/** Single-flight: concurrent callers share one refresh request. */
export function refreshSession(): Promise<RefreshedSession | null> {
  inflightRefresh ??= runExclusive(performRefresh).finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (config.skipAuth) return config;
  const token = accessTokenStore.get();
  config.sentWithToken = token;
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

/**
 * Only the access guard's own 401 (code UNAUTHORIZED) means "token no longer
 * valid". Business 401s such as INVALID_CREDENTIALS on password change must
 * not trigger a refresh or a logout.
 */
function isAccessTokenRejection(error: AxiosError): boolean {
  if (error.response?.status !== 401) return false;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  return code === undefined || code === 'UNAUTHORIZED';
}

http.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config;
  if (isAccessTokenRejection(error) && config && !config.skipAuth && !config.replayedAfterRefresh) {
    config.replayedAfterRefresh = true;
    // A 401 is produced by the access guard before any handler runs, so
    // replaying the request (mutations included) cannot apply it twice.
    const current = accessTokenStore.get();
    const token = current && current !== config.sentWithToken ? current : ((await refreshSession())?.accessToken ?? null);
    if (token) return http.request(config);
    notifySessionExpired();
  }
  throw toApiError(error);
});
