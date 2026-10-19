import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/features/auth/api/auth.api';
import { farmsApi } from '@/features/farms/api/farms.api';
import { PHONES, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { onSessionExpired, refreshSession } from './client';
import { ApiError, errorMessage, toApiError, validationFieldErrors } from './errors';
import { accessTokenStore } from './token-store';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const refreshCalls = () => api.requests.filter((request) => request.path === '/auth/refresh').length;

describe('session refresh', () => {
  it('restores the access token from the refresh cookie + CSRF header', async () => {
    const session = await refreshSession();
    expect(session?.accessToken).toBeTruthy();
    expect(accessTokenStore.get()).toBe(session?.accessToken);
    const refresh = api.requests.find((request) => request.path === '/auth/refresh');
    expect(refresh?.headers['x-csrf-token']).toBe(api.server.db.csrfToken);
    expect(refresh?.headers.authorization).toBeUndefined();
  });

  it('runs one refresh for concurrent 401s and replays every request', async () => {
    accessTokenStore.set('expired-token');
    const [me, farms] = await Promise.all([authApi.me(), farmsApi.list()]);
    expect(me.phone).toBe(PHONES.farmer);
    expect(farms.total).toBe(1);
    expect(refreshCalls()).toBe(1);
  });

  it('does not refresh on business 401s such as a wrong current password', async () => {
    await refreshSession();
    const before = refreshCalls();
    const error = await authApi
      .changePassword({ currentPassword: 'wrong-pass1', newPassword: 'Yangi2026parol' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect(refreshCalls()).toBe(before);
  });

  it('signals session expiry when the refresh is rejected', async () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = onSessionExpired(listener);
    // The server revoked every session (e.g. logout on another device).
    for (const session of api.server.db.sessions) session.revoked = true;
    accessTokenStore.set('expired-token');
    const error = await authApi.me().catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(accessTokenStore.get()).toBeNull();
    unsubscribe();
  });

  it('skips the refresh call entirely without a CSRF cookie', async () => {
    document.cookie = 'mf_csrf=; path=/; max-age=0';
    expect(await refreshSession()).toBeNull();
    expect(refreshCalls()).toBe(0);
  });
});

describe('error normalization', () => {
  function axiosError(status: number | null, data?: unknown, headers: Record<string, string> = {}): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError(
      'failed',
      'ERR',
      config,
      {},
      status === null ? undefined : { status, statusText: '', data, headers: new AxiosHeaders(headers), config },
    );
  }

  it('maps a missing response to a network error', () => {
    const error = toApiError(axiosError(null));
    expect(error.isNetworkError).toBe(true);
    expect(error.message).toMatch(/aloqa/);
  });

  it('keeps the backend Uzbek message and request id', () => {
    const error = toApiError(
      axiosError(409, {
        statusCode: 409,
        code: 'INSUFFICIENT_STOCK',
        message: 'Omborda yetarli miqdor yo‘q',
        requestId: 'req-1',
      }),
    );
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK', requestId: 'req-1' });
    expect(error.message).toBe('Omborda yetarli miqdor yo‘q');
  });

  it('turns validation arrays into a plain message and field errors', () => {
    const raw = axiosError(400, {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: ['weightKg must be a decimal string', 'property x should not exist'],
    });
    expect(errorMessage(raw)).toBe('Kiritilgan ma’lumotlarni tekshiring');
    expect(validationFieldErrors(raw, ['weightKg', 'tagNumber'] as const)).toEqual({
      weightKg: 'Qiymat noto‘g‘ri yoki talablarga mos emas',
    });
  });

  it('adds the wait time to rate-limit messages', () => {
    const raw = axiosError(429, {
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Juda ko‘p so‘rov',
      details: { retryAfterSeconds: 30 },
    });
    expect(errorMessage(raw)).toBe('Juda ko‘p so‘rov (30 soniyadan keyin)');
  });

  it('never exposes raw 5xx details', () => {
    const error = toApiError(axiosError(502, '<html>Bad gateway</html>'));
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).not.toContain('html');
  });
});
