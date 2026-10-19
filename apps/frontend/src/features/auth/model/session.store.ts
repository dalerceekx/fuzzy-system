import { create } from 'zustand';

export type SessionStatus = 'initializing' | 'authenticated' | 'anonymous' | 'unreachable';

export interface MfaChallenge {
  kind: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  /** Short-lived, single-use; kept in memory only. */
  mfaToken: string;
  expiresAt: number;
}

export type LoginNotice = 'expired' | 'logged-out-elsewhere' | 'password-reset' | 'phone-verified' | null;

/** Why the last session ended; decides whether the next login returns to the old page. */
export type SessionEndReason = 'logout' | 'expired' | 'logged-out-elsewhere' | 'error';

interface SessionState {
  status: SessionStatus;
  mfaChallenge: MfaChallenge | null;
  notice: LoginNotice;
  endReason: SessionEndReason | null;
  setStatus: (status: SessionStatus) => void;
  setMfaChallenge: (challenge: MfaChallenge | null) => void;
  setNotice: (notice: LoginNotice) => void;
}

/**
 * Client-side session state only. The user profile itself is server state
 * and lives in TanStack Query (`authKeys.me`).
 */
export const useSessionStore = create<SessionState>((set) => ({
  status: 'initializing',
  mfaChallenge: null,
  notice: null,
  endReason: null,
  setStatus: (status) => set({ status }),
  setMfaChallenge: (mfaChallenge) => set({ mfaChallenge }),
  setNotice: (notice) => set({ notice }),
}));
