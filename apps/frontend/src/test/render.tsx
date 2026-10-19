import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthBootstrap } from '@/app/providers/AuthBootstrap';
import { routes } from '@/app/router/routes';
import { useSessionStore } from '@/features/auth/model/session.store';
import { useActiveFarmStore } from '@/features/farms/model/active-farm';
import { http } from '@/shared/api/client';
import { accessTokenStore } from '@/shared/api/token-store';
import { Toaster, useToastStore } from '@/shared/ui/toast';
import { createMockAdapter } from '@/mocks/adapter';
import { createSeedDb, MOCK_MFA_CODE, type MockDb } from '@/mocks/db';
import { createMockServer, type MockServer, type MockRequest } from '@/mocks/server';

export interface RecordedRequest extends MockRequest {
  status: number;
}

export interface TestApi {
  server: MockServer;
  requests: RecordedRequest[];
}

/** Routes the shared HTTP client to a fresh in-memory mock backend. */
export function setupMockApi(db: MockDb = createSeedDb()): TestApi {
  const server = createMockServer(db);
  const requests: RecordedRequest[] = [];
  const recordingServer: MockServer = {
    db: server.db,
    handle(request) {
      const response = server.handle(request);
      requests.push({ ...request, status: response.status });
      return response;
    },
  };
  http.defaults.adapter = createMockAdapter(recordingServer);
  return { server: recordingServer, requests };
}

/** Clears every piece of client state between tests. */
export function resetClientState(): void {
  accessTokenStore.clear();
  useSessionStore.setState({ status: 'initializing', mfaChallenge: null, notice: null, endReason: null });
  useActiveFarmStore.setState({ byUser: {} });
  useToastStore.setState({ toasts: [] });
  window.localStorage.clear();
}

/**
 * Logs `phone` in against the mock server (MFA included) and plants the
 * CSRF cookie, so the app restores the session through /auth/refresh on
 * mount — exactly like a page reload with a valid refresh cookie.
 */
export function signIn(api: TestApi, phone: string, password: string): void {
  const login = api.server.handle({ method: 'POST', path: '/auth/login', query: {}, headers: {}, body: { phone, password } });
  const body = login.body as { status: string; mfaToken?: string };
  if (body.status === 'MFA_SETUP_REQUIRED' || body.status === 'MFA_REQUIRED') {
    const path = body.status === 'MFA_SETUP_REQUIRED' ? '/auth/mfa/enable' : '/auth/mfa/verify';
    api.server.handle({ method: 'POST', path, query: {}, headers: {}, body: { mfaToken: body.mfaToken, code: MOCK_MFA_CODE } });
  }
  document.cookie = `mf_csrf=${encodeURIComponent(api.server.db.csrfToken ?? '')}; path=/`;
}

export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap>
        <RouterProvider router={router} />
      </AuthBootstrap>
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...view, router, user, queryClient };
}

export const PHONES = {
  superAdmin: '+998900000001',
  farmer: '+998900000002',
  admin: '+998900000003',
  vet: '+998900000004',
  support: '+998900000005',
} as const;
