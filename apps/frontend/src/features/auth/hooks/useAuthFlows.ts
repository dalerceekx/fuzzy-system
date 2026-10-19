import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { toApiError } from '@/shared/api/errors';
import { toast } from '@/shared/ui';
import { authApi } from '../api/auth.api';
import type { AuthenticatedResponse } from '../api/auth.types';
import { postLoginTarget } from '../lib/redirect';
import { endSession, startSession } from '../model/session';
import { useSessionStore } from '../model/session.store';

function useCompleteLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  return (response: AuthenticatedResponse) => {
    startSession(response, queryClient);
    navigate(postLoginTarget(response.user.role, location.state), { replace: true });
  };
}

export function useLogin() {
  const completeLogin = useCompleteLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const setMfaChallenge = useSessionStore((state) => state.setMfaChallenge);

  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (response) => {
      if (response.status === 'AUTHENTICATED') {
        completeLogin(response);
        return;
      }
      setMfaChallenge({
        kind: response.status,
        mfaToken: response.mfaToken,
        expiresAt: Date.now() + response.mfaTokenExpiresIn * 1000,
      });
      // Keep the original destination for after the MFA step.
      navigate(response.status === 'MFA_SETUP_REQUIRED' ? '/login/mfa-setup' : '/login/mfa', {
        state: location.state,
      });
    },
  });
}

export function useMfaVerify() {
  const completeLogin = useCompleteLogin();
  return useMutation({ mutationFn: authApi.mfaVerify, onSuccess: completeLogin });
}

export function useMfaSetup() {
  return useMutation({ mutationFn: authApi.mfaSetup });
}

export function useMfaEnable() {
  const completeLogin = useCompleteLogin();
  return useMutation({ mutationFn: authApi.mfaEnable, onSuccess: completeLogin });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      endSession(queryClient, 'logout');
      navigate('/login', { replace: true });
    },
    onError: (error) => {
      const apiError = toApiError(error);
      // 401: the session is already gone server-side — finish locally.
      if (apiError.status === 401) {
        endSession(queryClient, 'logout');
        navigate('/login', { replace: true });
        return;
      }
      // Otherwise the refresh cookie may still be valid: do not pretend the
      // user is signed out.
      toast.error(`Chiqib bo‘lmadi: ${apiError.message}`);
    },
  });
}

export function useLogoutAll() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => {
      endSession(queryClient, 'logout');
      navigate('/login', { replace: true });
    },
  });
}
