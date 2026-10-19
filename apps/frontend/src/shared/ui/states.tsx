import type { UseQueryResult } from '@tanstack/react-query';
import { Construction, Inbox, RefreshCw, ShieldX, WifiOff, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { toApiError } from '@/shared/api/errors';
import { cn } from '@/shared/lib/cn';
import { Badge } from './Badge';
import { Button } from './Button';
import { TableSkeleton } from './Skeleton';

interface StateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

function StateBox({ icon, title, description, action, className }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? (
        <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full bg-primary-light text-ink">
          {icon}
        </span>
      ) : null}
      <div className="max-w-md">
        <p className="text-base font-semibold text-ink">{title}</p>
        {description ? <div className="mt-1 text-sm text-ink-secondary">{description}</div> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon = <Inbox className="size-6" />, ...props }: StateProps) {
  return <StateBox icon={icon} {...props} />;
}

/**
 * A feature the backend does not provide (yet). Shown instead of fake data
 * or a pretend success — see docs/integration-gaps.md.
 */
export function GapState({
  title = 'Bu funksiya hali backend’da mavjud emas',
  description,
  action,
  className,
}: Partial<StateProps>) {
  return (
    <StateBox
      icon={<Construction className="size-6" />}
      title={
        <span className="inline-flex flex-col items-center gap-2">
          <Badge tone="warning">Tez orada</Badge>
          {title}
        </span>
      }
      description={description}
      action={action}
      className={className}
    />
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  /**
   * A 404 from a collection endpoint means the route itself is not deployed
   * (the backend answers unknown paths with 404) — show it as a gap.
   */
  collection?: boolean;
}

export function ErrorState({ error, onRetry, className, collection = false }: ErrorStateProps) {
  const apiError = toApiError(error);
  if (collection && apiError.status === 404) {
    return (
      <GapState
        className={className}
        title="Bu bo‘lim backend’da hali ishga tushirilmagan"
        description="Server bu so‘rovni tanimadi (404). Backend moduli tayyor bo‘lgach, ma’lumotlar shu yerda chiqadi."
      />
    );
  }
  if (apiError.status === 403) {
    return (
      <StateBox
        className={className}
        icon={<ShieldX className="size-6" />}
        title="Ruxsat yo‘q"
        description="Bu ma’lumotlarni ko‘rish uchun huquqingiz yetarli emas."
      />
    );
  }
  return (
    <StateBox
      className={className}
      icon={apiError.isNetworkError ? <WifiOff className="size-6" /> : <TriangleAlert className="size-6" />}
      title={apiError.isNetworkError ? 'Aloqa yo‘q' : 'Ma’lumotlarni yuklab bo‘lmadi'}
      description={
        <>
          <p>{apiError.message}</p>
          {apiError.requestId ? <p className="mt-1 text-[13px] text-ink-muted">So‘rov ID: {apiError.requestId}</p> : null}
        </>
      }
      action={
        onRetry ? (
          <Button variant="secondary" icon={<RefreshCw aria-hidden className="size-4" />} onClick={onRetry}>
            Qayta urinish
          </Button>
        ) : undefined
      }
    />
  );
}

interface AsyncContentProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError' | 'refetch'>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  collection?: boolean;
}

/** Loading → error → empty → content, the same way on every page. */
export function AsyncContent<T>({ query, children, loading, isEmpty, empty, collection }: AsyncContentProps<T>) {
  if (query.isPending) return <>{loading ?? <TableSkeleton />}</>;
  if (query.isError) {
    return <ErrorState error={query.error} collection={collection} onRetry={() => void query.refetch()} />;
  }
  const data = query.data as T;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title="Hozircha ma’lumot yo‘q" />}</>;
  return <>{children(data)}</>;
}
