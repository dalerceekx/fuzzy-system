import { Tractor } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/shared/lib/cn';
import { useActiveFarm } from '../model/active-farm';

/** Compact farm selector in the header; hidden when the farmer has one farm. */
export function FarmSwitcher({ className }: { className?: string }) {
  const { farms, activeFarm, setActiveFarm } = useActiveFarm();
  const id = useId();
  if (farms.length < 2 || !activeFarm) {
    return activeFarm ? (
      <span className={cn('inline-flex items-center gap-2 text-sm text-ink-secondary', className)}>
        <Tractor aria-hidden className="size-4" />
        <span className="max-w-[180px] truncate font-medium text-ink">{activeFarm.name}</span>
      </span>
    ) : null;
  }
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label htmlFor={id} className="sr-only">
        Faol ferma
      </label>
      <Tractor aria-hidden className="size-4 text-ink-secondary" />
      <select
        id={id}
        value={activeFarm.id}
        onChange={(event) => setActiveFarm(event.target.value)}
        className="min-h-10 max-w-[200px] rounded-[10px] border border-line bg-card px-2.5 text-sm font-medium text-ink hover:border-input-line"
      >
        {farms.map((farm) => (
          <option key={farm.id} value={farm.id}>
            {farm.name}
          </option>
        ))}
      </select>
    </div>
  );
}
