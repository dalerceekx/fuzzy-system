import { CSRF_HEADER, http, readCsrfToken } from '@/shared/api/client';
import type { PublicUser } from '@/shared/types/api';
import type { ActiveSession, AuthenticatedResponse, LoginResponse, MfaSetupResponse, VerificationResponse } from './auth.types';

/**
 * /api/v1/auth — CONTRACT §4. Public endpoints use `skipAuth`, so their
 * business 401s (wrong password, wrong code) never trigger a token refresh.
 */
export const authApi = {
  async login(body: { phone: string; password: string }): Promise<LoginResponse> {
    const { data } = await http.post<LoginResponse>('/auth/login', body, { skipAuth: true });
    return data;
  },

  async mfaSetup(mfaToken: string): Promise<MfaSetupResponse> {
    const { data } = await http.post<MfaSetupResponse>('/auth/mfa/setup', { mfaToken }, { skipAuth: true });
    return data;
  },

  async mfaEnable(body: { mfaToken: string; code: string }): Promise<AuthenticatedResponse> {
    const { data } = await http.post<AuthenticatedResponse>('/auth/mfa/enable', body, { skipAuth: true });
    return data;
  },

  async mfaVerify(body: { mfaToken: string; code: string }): Promise<AuthenticatedResponse> {
    const { data } = await http.post<AuthenticatedResponse>('/auth/mfa/verify', body, { skipAuth: true });
    return data;
  },

  async me(): Promise<PublicUser> {
    const { data } = await http.get<PublicUser>('/auth/me');
    return data;
  },

  /** Revokes the current session; the server also clears the cookies. */
  async logout(): Promise<void> {
    const csrfToken = readCsrfToken();
    await http.post('/auth/logout', {}, { headers: csrfToken ? { [CSRF_HEADER]: csrfToken } : {} });
  },

  async logoutAll(): Promise<void> {
    const csrfToken = readCsrfToken();
    await http.post('/auth/logout-all', {}, { headers: csrfToken ? { [CSRF_HEADER]: csrfToken } : {} });
  },

  async sessions(): Promise<ActiveSession[]> {
    const { data } = await http.get<ActiveSession[] | { items: ActiveSession[] }>('/auth/sessions');
    return Array.isArray(data) ? data : data.items;
  },

  async revokeSession(sessionId: string): Promise<void> {
    await http.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
  },

  async changePassword(body: { currentPassword: string; newPassword: string }): Promise<void> {
    await http.post('/auth/password/change', body);
  },

  async register(body: { phone: string; fullName: string; password: string }): Promise<VerificationResponse> {
    const { data } = await http.post<VerificationResponse>('/auth/otp/send', body, { skipAuth: true });
    return data;
  },

  async verifyPhone(body: { verificationId: string; code: string }): Promise<{ message: string }> {
    const { data } = await http.post<{ message: string }>('/auth/otp/verify', body, { skipAuth: true });
    return data;
  },

  async resendOtp(verificationId: string): Promise<VerificationResponse> {
    const { data } = await http.post<VerificationResponse>('/auth/otp/resend', { verificationId }, { skipAuth: true });
    return data;
  },

  async forgotPassword(phone: string): Promise<VerificationResponse> {
    const { data } = await http.post<VerificationResponse>('/auth/password/forgot', { phone }, { skipAuth: true });
    return data;
  },

  async resetPassword(body: { verificationId: string; code: string; newPassword: string }): Promise<void> {
    await http.post('/auth/password/reset', body, { skipAuth: true });
  },
};
