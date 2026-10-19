import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { Decimal } from '@/shared/lib/decimal';
import { cn } from '@/shared/lib/cn';
import { formatQuantity, isIncoming, MOVEMENT_LABELS } from '../lib/labels';
import type { LedgerMovement } from '../model/inventory.queries';

export function itemPath(movement: Pick<LedgerMovement, 'item'>): string {
  return movement.item.category === 'MEDICINE' ? `/medicines/stock/${movement.item.id}` : `/feed/${movement.item.id}`;
}

/** Compact list of the latest stock movements across items. */
export function RecentMovements({ movements }: { movements: LedgerMovement[] }) {
  if (movements.length === 0) {
    return <p className="px-5 py-8 text-center text-ink-secondary">Hali ombor harakatlari yo‘q</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {movements.map((movement) => {
        const incoming = isIncoming(movement.type);
        const cost =
          movement.unitCost && movement.type === 'IN'
            ? Decimal.from(movement.quantity).mul(Decimal.from(movement.unitCost))
            : null;
        return (
          <li key={movement.id}>
            <Link to={itemPath(movement)} className="flex items-center gap-3 px-5 py-3 hover:bg-background">
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-full',
                  incoming ? 'bg-success-light text-success' : 'bg-warning-light text-warning',
                )}
              >
                {incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{movement.item.name}</span>
                <span className="block text-[13px] text-ink-secondary">
                  {MOVEMENT_LABELS[movement.type]} · {formatDateTime(movement.createdAt)}
                </span>
              </span>
              <span className="text-right">
                <span className={cn('block font-semibold tabular', incoming ? 'text-success' : 'text-ink')}>
                  {incoming ? '+' : '−'}
                  {formatQuantity(movement.quantity, movement.item.unit)}
                </span>
                {cost ? <span className="block text-[13px] text-ink-secondary tabular">{formatMoney(cost)}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
