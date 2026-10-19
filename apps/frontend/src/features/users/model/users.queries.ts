import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllPages } from '@/shared/api/pagination';
import type { UserRole } from '@/shared/types/api';
import { usersApi, type CreateUserInput, type UserListQuery } from '../api/users.api';

export const userKeys = {
  all: ['admin-users'] as const,
  page: (query: UserListQuery) => ['admin-users', 'page', query] as const,
  everyone: ['admin-users', 'everyone'] as const,
  detail: (id: string) => ['admin-users', 'detail', id] as const,
};

export function useUsersPage(query: UserListQuery) {
  return useQuery({ queryKey: userKeys.page(query), queryFn: () => usersApi.list(query), placeholderData: keepPreviousData });
}

/**
 * Every visible user (100 per request, capped). Each list request is
 * audited by the backend, so dashboards share this one cached query instead
 * of firing a request per counter.
 */
export function useAllUsers() {
  return useQuery({
    queryKey: userKeys.everyone,
    queryFn: () => fetchAllPages((page, limit) => usersApi.list({ page, limit, sort: '-createdAt' }), 1_000),
    staleTime: 5 * 60_000,
  });
}

export function useUser(id: string) {
  return useQuery({ queryKey: userKeys.detail(id), queryFn: () => usersApi.get(id) });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: userKeys.all });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: (body: CreateUserInput) => usersApi.create(body), onSuccess: invalidate });
}

export function useChangeRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => usersApi.changeRole(id, role),
    onSuccess: invalidate,
  });
}

export function useBlockUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => usersApi.block(id, reason),
    onSuccess: invalidate,
  });
}

export function useUnblockUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: (id: string) => usersApi.unblock(id), onSuccess: invalidate });
}

export function useArchiveUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => usersApi.archive(id, reason),
    onSuccess: invalidate,
  });
}

export function useRevokeUserSessions() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: (id: string) => usersApi.revokeSessions(id), onSuccess: invalidate });
}

export function useResetUserMfa() {
  const invalidate = useInvalidateUsers();
  return useMutation({ mutationFn: (id: string) => usersApi.resetMfa(id), onSuccess: invalidate });
}
