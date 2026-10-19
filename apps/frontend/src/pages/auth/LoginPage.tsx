import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { useSessionStore, type LoginNotice } from '@/features/auth/model/session.store';
import { Alert } from '@/shared/ui';

const NOTICES: Record<Exclude<LoginNotice, null>, { tone: 'info' | 'success'; text: string }> = {
  expired: { tone: 'info', text: 'Sessiya muddati tugadi. Iltimos, qaytadan kiring.' },
  'logged-out-elsewhere': { tone: 'info', text: 'Boshqa oynada tizimdan chiqildi.' },
  'password-reset': { tone: 'success', text: 'Parol yangilandi. Yangi parol bilan kiring.' },
  'phone-verified': { tone: 'success', text: 'Telefon raqami tasdiqlandi. Endi tizimga kirishingiz mumkin.' },
};

export default function LoginPage() {
  const location = useLocation();
  const phone = (location.state as { phone?: string } | null)?.phone ?? '';
  // A notice is shown once: copy it on mount, then clear it from the store.
  const [notice] = useState<LoginNotice>(() => useSessionStore.getState().notice);
  useEffect(() => {
    useSessionStore.getState().setNotice(null);
  }, []);

  const noticeContent = notice ? NOTICES[notice] : null;

  return (
    <AuthLayout
      title="Xush kelibsiz!"
      description="Fermangizni boshqarish uchun tizimga kiring."
      footer={
        <>
          Hisobingiz yo‘qmi?{' '}
          <Link to="/register" className="font-medium text-warning underline-offset-4 hover:underline">
            Ro‘yxatdan o‘ting
          </Link>
        </>
      }
    >
      {noticeContent ? (
        <Alert tone={noticeContent.tone} className="mb-5">
          {noticeContent.text}
        </Alert>
      ) : null}
      <LoginForm defaultPhone={phone} />
    </AuthLayout>
  );
}
