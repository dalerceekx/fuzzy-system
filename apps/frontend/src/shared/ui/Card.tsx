import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('rounded-[14px] border border-line bg-card shadow-card', className)} {...props} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Heading level for the document outline (default h2). */
  as?: 'h2' | 'h3';
}

export function CardHeader({ title, description, icon, actions, className, as: Heading = 'h2' }: CardHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span
            aria-hidden
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-ink"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <Heading className="text-base font-semibold text-ink">{title}</Heading>
          {description ? <p className="mt-0.5 text-sm text-ink-secondary">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

/** Label/value rows for details panels. */
export function DescriptionList({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-[13px] text-ink-secondary">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[15px] font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
