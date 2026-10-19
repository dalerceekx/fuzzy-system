import { http } from '@/shared/api/client';
import { cleanParams } from '@/shared/api/pagination';
import type { PageQuery, Paginated, PublicUser, UserRole, UserStatus } from '@/shared/types/api';

export interface UserListQuery extends PageQuery {
  role?: UserRole;
  status?: UserStatus;
  /** Exact, normalized (+998XXXXXXXXX). */
  phone?: string;
  isDemo?: boolean;
}

export interface AdminUserDetails extends PublicUser {
  /** Active session count (field name tolerated in both spellings). */
  sessionCount?: number;
  activeSessionCount?: number;
}

export interface CreateUserInput {
  phone: string;
  fullName: string;
  role: UserRole;
  password: string;
}

/** /api/v1/admin/users (CONTRACT §5). Every staff read is audited server-side. */
export const usersApi = {
  async list(query: UserListQuery = {}): Promise<Paginated<PublicUser>> {
    const { data } = await http.get<Paginated<PublicUser>>('/admin/users', { params: cleanParams({ ...query }) });
    return data;
  },

  async get(id: string): Promise<AdminUserDetails> {
    const { data } = await http.get<AdminUserDetails>(`/admin/users/${id}`);
    return data;
  },

  async create(body: CreateUserInput): Promise<PublicUser> {
    const { data } = await http.post<PublicUser>('/admin/users', body);
    return data;
  },

  async changeRole(id: string, role: UserRole): Promise<PublicUser> {
    const { data } = await http.patch<PublicUser>(`/admin/users/${id}/role`, { role });
    return data;
  },

  async block(id: string, reason: string): Promise<PublicUser> {
    const { data } = await http.post<PublicUser>(`/admin/users/${id}/block`, { reason });
    return data;
  },

  async unblock(id: string): Promise<PublicUser> {
    const { data } = await http.post<PublicUser>(`/admin/users/${id}/unblock`, {});
    return data;
  },

  async archive(id: string, reason: string): Promise<PublicUser> {
    const { data } = await http.post<PublicUser>(`/admin/users/${id}/archive`, { reason });
    return data;
  },

  async revokeSessions(id: string): Promise<void> {
    await http.post(`/admin/users/${id}/sessions/revoke`, {});
  },

  async resetMfa(id: string): Promise<void> {
    await http.post(`/admin/users/${id}/mfa/reset`, {});
  },
};
