import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { endSession, initSession, subscribeToOtherTabs } from '@/features/auth/model/session';
import { useSessionStore } from '@/features/auth/model/session.store';
import { onSessionExpired } from '@/shared/api/client';

/**
 * Restores the session once per page load and reacts to session loss:
 * refresh rejected (expired/revoked) or a logout in another tab.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initSession(queryClient);
  }, [queryClient]);

  useEffect(() => {
    const unsubscribeExpired = onSessionExpired(() => {
      if (useSessionStore.getState().status === 'authenticated') endSession(queryClient, 'expired');
    });
    const unsubscribeTabs = subscribeToOtherTabs(queryClient);
    return () => {
      unsubscribeExpired();
      unsubscribeTabs();
    };
  }, [queryClient]);

  return <>{children}</>;
}
