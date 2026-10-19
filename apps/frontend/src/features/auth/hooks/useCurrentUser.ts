import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { authKeys } from '../model/keys';
import { useSessionStore } from '../model/session.store';

/** The signed-in user (GET /auth/me). Role and status always come from the server. */
export function useCurrentUser() {
  const status = useSessionStore((state) => state.status);
  return useQuery({
    queryKey: authKeys.me,
    queryFn: authApi.me,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });
}
