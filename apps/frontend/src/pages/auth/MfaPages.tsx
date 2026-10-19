import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { MfaSetupPanel } from '@/features/auth/components/MfaSetupPanel';
import { MfaVerifyForm } from '@/features/auth/components/MfaVerifyForm';
import { useSessionStore, type MfaChallenge } from '@/features/auth/model/session.store';

function useSecondsLeft(expiresAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function useActiveChallenge(kind: MfaChallenge['kind']): { challenge: MfaChallenge | null; secondsLeft: number } {
  const challenge = useSessionStore((state) => state.mfaChallenge);
  const secondsLeft = useSecondsLeft(challenge?.expiresAt);
  const valid = challenge?.kind === kind && secondsLeft > 0 ? challenge : null;
  return { challenge: valid, secondsLeft };
}

const BACK_TO_LOGIN = (
  <Link to="/login" className="font-medium text-warning underline-offset-4 hover:underline">
    Kirish sahifasiga qaytish
  </Link>
);

export function MfaVerifyPage() {
  const { challenge, secondsLeft } = useActiveChallenge('MFA_REQUIRED');
  // The MFA token lives in memory only: after a reload or expiry, start over.
  if (!challenge) return <Navigate to="/login" replace />;
  return (
    <AuthLayout
      title="Ikki bosqichli tasdiqlash"
      description={`Hisobingiz qo‘shimcha himoyalangan. Kodni ${formatCountdown(secondsLeft)} ichida kiriting.`}
      footer={BACK_TO_LOGIN}
    >
      <MfaVerifyForm challenge={challenge} />
    </AuthLayout>
  );
}

export function MfaSetupPage() {
  const { challenge, secondsLeft } = useActiveChallenge('MFA_SETUP_REQUIRED');
  if (!challenge) return <Navigate to="/login" replace />;
  return (
    <AuthLayout
      title="Ikki bosqichli himoyani yoqing"
      description={`Administrator hisoblari uchun majburiy. Sozlash uchun ${formatCountdown(secondsLeft)} qoldi.`}
      footer={BACK_TO_LOGIN}
    >
      <MfaSetupPanel challenge={challenge} />
    </AuthLayout>
  );
}
