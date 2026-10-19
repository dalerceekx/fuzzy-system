import type { PublicUser } from '@/shared/types/api';

/** POST /auth/login, /auth/mfa/enable, /auth/mfa/verify success (web transport). */
export interface AuthenticatedResponse {
  status: 'AUTHENTICATED';
  accessToken: string;
  accessTokenExpiresIn: number;
  user: PublicUser;
}

/** Admin roles must pass TOTP before a session exists. */
export interface MfaChallengeResponse {
  status: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  mfaToken: string;
  mfaTokenExpiresIn: number;
}

export type LoginResponse = AuthenticatedResponse | MfaChallengeResponse;

export interface MfaSetupResponse {
  /** Base32 TOTP secret for manual entry. */
  secret: string;
  otpauthUrl: string;
}

/** Register / resend / forgot: uniform 202 so accounts cannot be enumerated. */
export interface VerificationResponse {
  verificationId: string;
  expiresIn: number;
  resendAfter: number;
  message: string;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  ip: string | null;
  userAgent: string | null;
  current?: boolean;
}

export interface DevSmsMessage {
  to: string;
  text: string;
  sentAt: string;
}
