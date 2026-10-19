import { LoaderCircle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface SpinnerProps {
  className?: string;
  /** Screen-reader text; omit when a visible label already says it. */
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <>
      <LoaderCircle aria-hidden className={cn('size-5 animate-spin', className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

export function PageLoader({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-ink-secondary">
      <Spinner className="size-7 text-warning" />
      <span>{label}</span>
    </div>
  );
}
