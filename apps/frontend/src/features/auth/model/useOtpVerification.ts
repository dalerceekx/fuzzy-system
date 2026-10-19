import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toApiError } from '@/shared/api/errors';
import { authApi } from '../api/auth.api';
import type { VerificationState } from '../components/RegisterForm';

/** Absolute deadlines keep the UI correct after a background tab or page reload. */
export function useOtpVerification(initial: VerificationState) {
  const navigate = useNavigate();
  const location = useLocation();
  const [challenge, setChallenge] = useState(initial);
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const resend = useMutation({ mutationFn: authApi.resendOtp });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiresAt = challenge.receivedAt + challenge.expiresIn * 1000;
  const availableAt = Math.max(challenge.receivedAt + challenge.resendAfter * 1000, retryAt);
  const expiresIn = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendAfter = Math.max(0, Math.ceil((availableAt - now) / 1000));

  function resendCode(onSuccess: () => void) {
    if (resend.isPending || Date.now() < availableAt) return;
    resend.mutate(challenge.verificationId, {
      onSuccess: (response) => {
        const receivedAt = Date.now();
        const next: VerificationState = { ...response, phone: challenge.phone, receivedAt };
        setChallenge(next);
        setNow(receivedAt);
        setRetryAt(0);
        // Preserve the latest challenge and its deadlines on refresh/back navigation.
        void navigate(location.pathname, { replace: true, state: next });
        onSuccess();
      },
      onError: (error) => {
        const retryAfter = toApiError(error).retryAfterSeconds;
        if (retryAfter) {
          const receivedAt = Date.now();
          setRetryAt(receivedAt + retryAfter * 1000);
          setNow(receivedAt);
        }
      },
    });
  }

  return {
    verificationId: challenge.verificationId,
    expiresAt,
    expiresIn,
    resendAfter,
    resend,
    resendCode,
  };
}
