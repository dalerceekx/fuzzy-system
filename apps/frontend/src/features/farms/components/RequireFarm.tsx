import { Plus, Tractor } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Card, ErrorState, PageLoader } from '@/shared/ui';
import type { Farm } from '../api/farms.api';
import { useActiveFarm } from '../model/active-farm';
import { FarmFormDialog } from './FarmFormDialog';

/**
 * Farm-scoped pages need a farm. A new farmer is guided to create one first
 * (one short form) instead of seeing empty tables.
 */
export function RequireFarm({ children }: { children: (farm: Farm) => ReactNode }) {
  const { farmsQuery, activeFarm } = useActiveFarm();
  const [creating, setCreating] = useState(false);

  if (farmsQuery.isPending) return <PageLoader />;
  if (farmsQuery.isError) {
    return (
      <Card>
        <ErrorState error={farmsQuery.error} collection onRetry={() => void farmsQuery.refetch()} />
      </Card>
    );
  }
  if (!activeFarm) {
    return (
      <Card className="mx-auto max-w-xl px-6 py-10 text-center">
        <span aria-hidden className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-primary-light">
          <Tractor className="size-7" />
        </span>
        <h2 className="mt-4 text-xl font-semibold">Avval fermangizni qo‘shing</h2>
        <p className="mt-2 text-ink-secondary">
          Hayvonlar, yem va dorilar ferma bo‘yicha yuritiladi. Ferma nomini kiriting — bu bir daqiqa oladi.
        </p>
        <Button className="mt-6" size="lg" icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
          Ferma qo‘shish
        </Button>
        <FarmFormDialog open={creating} onClose={() => setCreating(false)} />
      </Card>
    );
  }
  return <>{children(activeFarm)}</>;
}
