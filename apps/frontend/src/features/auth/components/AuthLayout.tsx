import type { ReactNode } from 'react';
import { BrandMark } from '@/shared/ui/BrandMark';

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered white card on the straw-tinted background. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <BrandMark size="lg" />
        </div>
        <div className="rounded-[16px] border border-line bg-card px-6 py-8 sm:px-8">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {description ? <div className="mt-1.5 text-[15px] text-ink-secondary">{description}</div> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-ink-secondary">{footer}</div> : null}
      </div>
    </main>
  );
}
