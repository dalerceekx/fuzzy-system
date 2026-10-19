import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { env } from '@/shared/config/env';
import { Alert } from '@/shared/ui';
import { Header, useRouteHandle } from '@/widgets/header/Header';
import { TabBar } from '@/widgets/tab-bar/TabBar';

function useDocumentTitle(): void {
  const handle = useRouteHandle();
  useEffect(() => {
    document.title = handle?.title ? `${handle.title} — MeningFermam` : 'MeningFermam';
  }, [handle?.title]);
}

/** Page title + description from the route handle. */
function PageHead() {
  const handle = useRouteHandle();
  if (!handle) return null;
  return (
    <div className="mb-5">
      <h1 className="text-[21px] leading-tight font-semibold text-ink sm:text-2xl">{handle.title}</h1>
      {handle.description ? <p className="mt-1 text-ink-secondary">{handle.description}</p> : null}
    </div>
  );
}

/** Top bar, centred content and the floating tab bar (the same on every screen width). */
export function AppLayout() {
  const { data: user } = useCurrentUser();
  useDocumentTitle();

  // RequireAuth guarantees the user before this layout renders.
  if (!user) return null;

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-[10px] bg-primary px-4 py-2 font-medium text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Asosiy mazmunga o‘tish
      </a>
      <Header user={user} />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1240px] px-4 pt-5 pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-[calc(116px+env(safe-area-inset-bottom))] lg:px-7"
      >
        {env.mockEnabled ? (
          <Alert tone="warning" className="mb-6" title="Namuna rejimi (VITE_ENABLE_MOCK)">
            Ma’lumotlar brauzer ichidagi soxta serverdan olinmoqda va backend’ga yuborilmaydi.
          </Alert>
        ) : null}
        {user.isDemo ? (
          <Alert tone="info" className="mb-6">
            Siz demo akkaunt bilan ishlayapsiz. Bu ma’lumotlar faqat sinov uchun.
          </Alert>
        ) : null}
        <PageHead />
        <Outlet />
      </main>
      <TabBar role={user.role} />
    </div>
  );
}
