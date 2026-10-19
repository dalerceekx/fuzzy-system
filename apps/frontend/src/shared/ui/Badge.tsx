import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral' | 'primary';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-light text-success border-success/25',
  danger: 'bg-danger-light text-danger border-danger/25',
  warning: 'bg-warning-light text-warning border-warning/25',
  neutral: 'bg-neutral-light text-ink-secondary border-line',
  primary: 'bg-primary-light text-ink border-primary-hover/40',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
