import type { QueryClient } from '@tanstack/react-query';
import { refreshSession } from '@/shared/api/client';
import { toApiError } from '@/shared/api/errors';
import { accessTokenStore } from '@/shared/api/token-store';
import type { AuthenticatedResponse } from '../api/auth.types';
import { authKeys } from './keys';
import { useSessionStore, type SessionEndReason } from './session.store';

const CHANNEL_NAME = 'meningfermam-auth';
type ChannelMessage = { type: 'logout' };

let channel: BroadcastChannel | null = null;

function authChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Called after login / MFA success. */
export function startSession(response: AuthenticatedResponse, queryClient: QueryClient): void {
  accessTokenStore.set(response.accessToken);
  queryClient.setQueryData(authKeys.me, response.user);
  useSessionStore.setState({ status: 'authenticated', mfaChallenge: null, notice: null, endReason: null });
}

/** Drops every trace of the session from memory and the query cache. */
export function endSession(queryClient: QueryClient, reason: SessionEndReason): void {
  accessTokenStore.clear();
  queryClient.clear();
  useSessionStore.setState({
    status: 'anonymous',
    mfaChallenge: null,
    notice: reason === 'expired' || reason === 'logged-out-elsewhere' ? reason : null,
    endReason: reason,
  });
  // Other tabs of this browser follow an explicit logout.
  if (reason === 'logout') authChannel()?.postMessage({ type: 'logout' } satisfies ChannelMessage);
}

/**
 * Restores a session after a page load: the access token lives in memory,
 * so it is re-issued from the HttpOnly refresh cookie.
 */
export async function initSession(queryClient: QueryClient): Promise<void> {
  useSessionStore.setState({ status: 'initializing' });
  try {
    const refreshed = await refreshSession();
    if (!refreshed) {
      useSessionStore.setState({ status: 'anonymous' });
      return;
    }
    if (refreshed.user) queryClient.setQueryData(authKeys.me, refreshed.user);
    useSessionStore.setState({ status: 'authenticated' });
  } catch (error) {
    const apiError = toApiError(error);
    useSessionStore.setState({ status: apiError.isNetworkError || apiError.isServerError ? 'unreachable' : 'anonymous' });
  }
}

/** Mirrors logouts from other tabs of the same browser. */
export function subscribeToOtherTabs(queryClient: QueryClient): () => void {
  const current = authChannel();
  if (!current) return () => undefined;
  const onMessage = (event: MessageEvent<ChannelMessage>) => {
    if (event.data?.type === 'logout' && useSessionStore.getState().status === 'authenticated') {
      endSession(queryClient, 'logged-out-elsewhere');
    }
  };
  current.addEventListener('message', onMessage);
  return () => current.removeEventListener('message', onMessage);
}
