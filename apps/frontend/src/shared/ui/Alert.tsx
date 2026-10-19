import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

type AlertTone = 'info' | 'warning' | 'danger' | 'success';

const STYLES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: {
    box: 'bg-primary-light/60 border-primary-hover/40 text-ink',
    icon: <Info aria-hidden className="size-5 text-warning" />,
  },
  warning: {
    box: 'bg-warning-light border-warning/30 text-ink',
    icon: <TriangleAlert aria-hidden className="size-5 text-warning" />,
  },
  danger: { box: 'bg-danger-light border-danger/30 text-ink', icon: <CircleAlert aria-hidden className="size-5 text-danger" /> },
  success: {
    box: 'bg-success-light border-success/30 text-ink',
    icon: <CircleCheck aria-hidden className="size-5 text-success" />,
  },
};

interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** role="alert" interrupts screen readers — use only for urgent messages. */
  urgent?: boolean;
}

export function Alert({ tone = 'info', title, children, action, className, urgent = false }: AlertProps) {
  const style = STYLES[tone];
  return (
    <div
      role={urgent ? 'alert' : 'note'}
      className={cn('flex gap-3 rounded-[12px] border px-4 py-3 text-sm', style.box, className)}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn('text-ink-secondary', title ? 'mt-0.5' : undefined)}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
