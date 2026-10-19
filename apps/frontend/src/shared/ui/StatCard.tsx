import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Badge } from './Badge';
import { Skeleton } from './Skeleton';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  secondary?: ReactNode;
  loading?: boolean;
  /** Metric not provided by the backend: shows "—" and a label, never 0. */
  unavailable?: boolean;
  /** Metric failed to load. */
  failed?: boolean;
  to?: string;
  /** Small horizontal card (icon beside the numbers) — two fit side by side on a phone. */
  compact?: boolean;
}

export function StatCard({ icon, label, value, secondary, loading, unavailable, failed, to, compact = false }: StatCardProps) {
  const shown = loading ? <Skeleton className={compact ? 'h-6 w-16' : 'h-8 w-24'} /> : unavailable || failed ? '—' : value;
  const note = unavailable ? 'Backend’da hali mavjud emas' : failed ? 'Yuklab bo‘lmadi' : loading ? null : secondary;

  const body = compact ? (
    <div className="flex items-center gap-2.5">
      {/* The icon gives its room to the numbers on a phone (two cards per row). */}
      <span
        aria-hidden
        className="hidden size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-ink sm:inline-flex [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-tight font-medium text-ink-secondary">{label}</p>
        <div className="mt-0.5 text-[16px] leading-tight font-semibold break-words text-ink tabular">{shown}</div>
        {note ? <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{note}</p> : null}
      </div>
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between gap-3">
        <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-[12px] bg-primary-light text-ink">
          {icon}
        </span>
        {unavailable ? <Badge tone="warning">Tez orada</Badge> : null}
      </div>
      <p className="mt-4 text-sm font-medium text-ink-secondary">{label}</p>
      <div className="mt-1 text-[28px] leading-tight font-semibold text-ink tabular">{shown}</div>
      <div className="mt-1 min-h-5 text-[13px] text-ink-secondary">{note}</div>
    </>
  );

  const className = cn(
    'block min-w-0 rounded-[14px] border border-line bg-card shadow-card',
    compact ? 'px-3 py-2.5' : 'p-5',
    to && 'transition-colors hover:border-primary-hover',
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
