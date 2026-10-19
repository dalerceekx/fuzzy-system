import { TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, ButtonLink } from '@/shared/ui';

/** Last-resort boundary: a crashed page never leaves a blank screen. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (import.meta.env.DEV && !notFound) console.error(error);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full bg-warning-light text-warning">
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">{notFound ? 'Sahifa topilmadi' : 'Sahifani ko‘rsatishda xatolik'}</h1>
      <p className="max-w-md text-ink-secondary">
        {notFound
          ? 'Manzil noto‘g‘ri yoki sahifa o‘chirilgan.'
          : 'Sahifani yangilab ko‘ring. Muammo takrorlansa, administratorga xabar bering.'}
      </p>
      <div className="flex gap-2">
        {notFound ? null : <Button onClick={() => window.location.reload()}>Sahifani yangilash</Button>}
        <ButtonLink to="/" variant="secondary">
          Bosh sahifa
        </ButtonLink>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="text-5xl font-bold text-warning">404</p>
      <h1 className="text-lg font-semibold">Sahifa topilmadi</h1>
      <p className="text-ink-secondary">Manzil noto‘g‘ri yoki sahifa ko‘chirilgan.</p>
      <ButtonLink to="/">Bosh sahifaga qaytish</ButtonLink>
    </div>
  );
}
