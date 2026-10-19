import { Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import { INVENTORY_CATEGORIES, type InventoryCategory } from '@/features/inventory/api/inventory.api';
import { itemPath } from '@/features/inventory/components/RecentMovements';
import { CATEGORY_LABELS, formatQuantity } from '@/features/inventory/lib/labels';
import { purchasesOf, sumAmounts, type Purchase } from '@/features/inventory/lib/ledger';
import { useLedger } from '@/features/inventory/model/inventory.queries';
import { cn } from '@/shared/lib/cn';
import { monthKey, todayInTashkent } from '@/shared/lib/dates';
import { formatDate, formatInteger, formatMoney } from '@/shared/lib/format';
import {
  Alert,
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  Pagination,
  Select,
  Skeleton,
  type Column,
} from '@/shared/ui';
import { AddExpenseDialog } from './AddExpenseDialog';

const PAGE_SIZE = 10;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Anchor of the panel on the dashboard (old /expenses links land here). */
export const EXPENSES_ANCHOR = 'xarajatlar';

function MiniStat({
  label,
  value,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
  className?: string;
}) {
  return (
    <div className={cn('rounded-[14px] border border-line bg-background px-3.5 py-3', className)}>
      <p className="text-[13px] text-ink-secondary">{label}</p>
      <div className="mt-1 text-lg leading-tight font-semibold text-ink tabular">
        {loading ? <Skeleton className="h-6 w-24" /> : value}
      </div>
    </div>
  );
}

/**
 * Dashboard panel: the farm's spending the backend can prove — stock
 * purchases (IN movements with a unit cost). Movements are append-only, so
 * rows are read-only ("Ombordan"); a new expense is recorded as a purchase.
 */
export function ExpensesPanel({ farm }: { farm: Farm }) {
  const ledger = useLedger(farm.id);
  // 'YYYY-MM'; '' = the whole period.
  const [month, setMonth] = useState(() => todayInTashkent().slice(0, 7));
  const [category, setCategory] = useState<InventoryCategory | ''>('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // Every navigation to the anchor scrolls again (a new location object), even with the same hash.
  useEffect(() => {
    if (location.hash === `#${EXPENSES_ANCHOR}`) panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [location]);

  const purchases = useMemo(
    () =>
      purchasesOf(ledger.data?.movements ?? []).filter(
        (purchase) =>
          (!month || monthKey(purchase.movement.createdAt) === month) &&
          (!category || purchase.movement.item.category === category),
      ),
    [ledger.data, month, category],
  );
  const total = sumAmounts(purchases);
  const feedTotal = sumAmounts(purchases.filter((purchase) => purchase.movement.item.category === 'FEED'));

  const columns: Column<Purchase>[] = [
    { key: 'date', header: 'Sana', cell: (purchase) => formatDate(purchase.movement.createdAt) },
    {
      key: 'item',
      header: 'Mahsulot',
      cell: (purchase) => (
        <ButtonLink to={itemPath(purchase.movement)} variant="ghost" size="sm" className="-ml-3 font-semibold text-ink">
          {purchase.movement.item.name}
        </ButtonLink>
      ),
    },
    { key: 'category', header: 'Toifa', cell: (purchase) => CATEGORY_LABELS[purchase.movement.item.category] },
    {
      key: 'quantity',
      header: 'Miqdor',
      align: 'right',
      cell: (purchase) => formatQuantity(purchase.movement.quantity, purchase.movement.item.unit),
    },
    {
      key: 'price',
      header: 'Narxi',
      align: 'right',
      hideOnMobile: true,
      cell: (purchase) => formatMoney(purchase.movement.unitCost),
    },
    { key: 'amount', header: 'Summa', align: 'right', cell: (purchase) => <strong>{formatMoney(purchase.amount)}</strong> },
    { key: 'source', header: 'Manba', cell: () => <Badge tone="primary">Ombordan</Badge> },
  ];

  function changeFilters(next: () => void): void {
    next();
    setPage(1);
  }

  return (
    <Card id={EXPENSES_ANCHOR} ref={panelRef} aria-labelledby={headingId} className="scroll-mt-24 p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-[17px] font-semibold text-ink">
          Xarajatlar
        </h2>
        <Button size="sm" icon={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
          Xarajat qo‘shish
        </Button>
      </div>
      <p className="mt-1 text-[13px] text-ink-secondary">
        Omborga narxi bilan kiritilgan xaridlar avtomatik qo‘shiladi. Transport, ish haqi kabi boshqa xarajatlarni kiritish
        backend’da hali yo‘q.
      </p>

      <div className="mt-4 grid gap-2.5 sm:flex sm:flex-wrap sm:items-end">
        <Field label="Oy" className="sm:w-[190px]">
          <Input
            type="month"
            value={month}
            max={todayInTashkent().slice(0, 7)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '' || MONTH_PATTERN.test(value)) changeFilters(() => setMonth(value));
            }}
          />
        </Field>
        <Field label="Toifa" className="sm:w-[190px]">
          <Select
            value={category}
            onChange={(event) => changeFilters(() => setCategory(event.target.value as InventoryCategory | ''))}
          >
            <option value="">Barcha toifalar</option>
            {INVENTORY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" aria-pressed={month === ''} onClick={() => changeFilters(() => setMonth(''))}>
          Barcha davr
        </Button>
      </div>

      <section aria-label="Xarajatlar ko‘rsatkichlari" className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <MiniStat
          label="Jami"
          value={ledger.isError ? '—' : formatMoney(total)}
          loading={ledger.isPending}
          className="col-span-2 sm:col-span-1"
        />
        <MiniStat label="Shundan yem" value={ledger.isError ? '—' : formatMoney(feedTotal)} loading={ledger.isPending} />
        <MiniStat label="Yozuvlar" value={ledger.isError ? '—' : formatInteger(purchases.length)} loading={ledger.isPending} />
      </section>

      {ledger.data?.truncated ? (
        <Alert tone="warning" className="mt-4">
          Ma’lumotlar juda ko‘p — eng so‘nggi yozuvlar asosida hisoblandi.
        </Alert>
      ) : null}

      <div className="-mx-[18px] mt-4 -mb-[18px] border-t border-line">
        <AsyncContent
          query={ledger}
          collection
          isEmpty={() => purchases.length === 0}
          empty={
            <EmptyState
              title={month ? 'Bu oyda xarajat yo‘q' : 'Hali xarajat yo‘q'}
              description="Oyni yoki toifani o‘zgartirib ko‘ring, yoki yangi xaridni kiriting."
            />
          }
        >
          {() => (
            <>
              <DataTable
                caption="Xarajatlar"
                columns={columns}
                rows={purchases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
                rowKey={(purchase) => purchase.movement.id}
              />
              <Pagination page={page} limit={PAGE_SIZE} total={purchases.length} onPageChange={setPage} />
            </>
          )}
        </AsyncContent>
      </div>

      {adding ? <AddExpenseDialog farm={farm} onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}
