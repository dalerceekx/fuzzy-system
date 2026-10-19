import { Calculator, History, Layers, PawPrint, Plus, Receipt, Wallet, Warehouse, Wheat } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { SPECIES_LABELS } from '@/features/animals/lib/labels';
import { useAnimalCounts } from '@/features/animals/model/animals.queries';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { EXPENSES_ANCHOR, ExpensesPanel } from '@/features/expenses/components/Expenses';
import { TodayRations } from '@/features/rations/components/TodayRations';
import type { Farm } from '@/features/farms/api/farms.api';
import { RecentMovements } from '@/features/inventory/components/RecentMovements';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { currentMonthRange, inRange, purchasesOf, sumAmounts } from '@/features/inventory/lib/ledger';
import { formatTotals, totalsByUnit } from '@/features/inventory/lib/stock-math';
import { useInventoryItems, useLedger } from '@/features/inventory/model/inventory.queries';
import { Decimal } from '@/shared/lib/decimal';
import { formatInteger, formatMoney } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, CardBody, CardHeader, ErrorState, Skeleton, StatCard } from '@/shared/ui';
import { BarList } from '@/shared/ui/charts';

const EXPENSES_LINK = `/dashboard#${EXPENSES_ANCHOR}`;

function QuickAction({ to, icon, label, description }: { to: string; icon: ReactNode; label: string; description: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[76px] items-center gap-3 rounded-[14px] border border-line bg-card px-4 py-3 shadow-card transition-colors hover:border-primary-hover hover:bg-primary-light/40"
    >
      <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-primary text-ink">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{label}</span>
        <span className="block text-[13px] text-ink-secondary">{description}</span>
      </span>
    </Link>
  );
}

export function FarmerDashboard({ farm }: { farm: Farm }) {
  const { data: user } = useCurrentUser();
  const counts = useAnimalCounts(farm.id);
  const feed = useInventoryItems(farm.id, 'FEED');
  const ledger = useLedger(farm.id);

  const feedItems = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const purchases = useMemo(() => purchasesOf(ledger.data?.movements ?? []), [ledger.data]);
  const monthRange = currentMonthRange();
  const monthSpend = sumAmounts(purchases.filter((purchase) => inRange(purchase.movement, monthRange)));

  const speciesRows = counts.bySpecies.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  const topSpecies = speciesRows
    .slice(0, 2)
    .map((row) => `${SPECIES_LABELS[row.species]}: ${formatInteger(row.count)}`)
    .join(' · ');
  const lowFeed = [...feedItems].sort((a, b) => Decimal.from(a.quantity).compare(Decimal.from(b.quantity))).slice(0, 5);
  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-ink-secondary">
        Assalomu alaykum{firstName ? `, ${firstName}` : ''}! <span className="text-ink">{farm.name}</span> bo‘yicha bugungi holat.
      </p>

      <section aria-label="Asosiy ko‘rsatkichlar" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<PawPrint className="size-5" />}
          label="Jami hayvonlar"
          value={counts.total === undefined ? '—' : formatInteger(counts.total)}
          secondary={topSpecies || 'Hali hayvon yo‘q'}
          loading={counts.isPending}
          failed={Boolean(counts.error)}
          to="/animals"
        />
        <StatCard icon={<Layers className="size-5" />} label="Hayvon guruhlari" value="—" unavailable to="/animal-groups" />
        <StatCard
          icon={<Warehouse className="size-5" />}
          label="Yem zaxirasi"
          value={<span className="text-[24px]">{formatTotals(totalsByUnit(feedItems))}</span>}
          secondary={`${formatInteger(feedItems.length)} turdagi yem`}
          loading={feed.isPending}
          failed={feed.isError}
          to="/feed"
        />
        <StatCard
          icon={<Wallet className="size-5" />}
          label="Oylik xarajatlar"
          value={<span className="text-[24px]">{formatMoney(monthSpend)}</span>}
          secondary="Shu oy, ombor xaridlari asosida"
          loading={ledger.isPending}
          failed={ledger.isError}
          to={EXPENSES_LINK}
        />
      </section>

      <TodayRations farm={farm} />

      <section aria-label="Tezkor amallar" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickAction
          to="/animals?new=1"
          icon={<Plus className="size-5" />}
          label="Hayvon qo‘shish"
          description="Yangi bosh ro‘yxatga"
        />
        <QuickAction to="/feed?new=1" icon={<Wheat className="size-5" />} label="Yem qo‘shish" description="Yangi yem turi" />
        <QuickAction
          to="/feed-calculator"
          icon={<Calculator className="size-5" />}
          label="Yem hisoblash"
          description="Miqdor va narx"
        />
        <QuickAction
          to={EXPENSES_LINK}
          icon={<Receipt className="size-5" />}
          label="Xarajat kiritish"
          description="Xaridlar va xarajatlar"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Hayvonlar bo‘yicha qisqacha"
            icon={<PawPrint className="size-5" />}
            actions={
              <ButtonLink to="/animals" variant="ghost" size="sm">
                Barchasi
              </ButtonLink>
            }
          />
          <CardBody>
            {counts.error ? (
              <ErrorState error={counts.error} collection onRetry={counts.refetch} />
            ) : counts.isPending ? (
              <Skeleton className="h-32" />
            ) : speciesRows.length === 0 ? (
              <p className="py-6 text-center text-ink-secondary">Hali hayvon qo‘shilmagan.</p>
            ) : (
              <BarList
                label="Hayvonlar turi bo‘yicha"
                max={counts.total}
                items={speciesRows.map((row) => ({
                  key: row.species,
                  label: (
                    <Link to={`/animals?species=${row.species}`} className="hover:underline">
                      {SPECIES_LABELS[row.species]}
                    </Link>
                  ),
                  value: row.count,
                  display: `${formatInteger(row.count)} bosh`,
                }))}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Yem ombori holati"
            description="Eng kam qolgan yemlar"
            icon={<Warehouse className="size-5" />}
            actions={
              <ButtonLink to="/feed" variant="ghost" size="sm">
                Omborga o‘tish
              </ButtonLink>
            }
          />
          <CardBody>
            {feed.isError ? (
              <ErrorState error={feed.error} collection onRetry={() => void feed.refetch()} />
            ) : feed.isPending ? (
              <Skeleton className="h-32" />
            ) : lowFeed.length === 0 ? (
              <p className="py-6 text-center text-ink-secondary">Omborda hali yem yo‘q.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lowFeed.map((item) => (
                  <li key={item.id}>
                    <Link to={`/feed/${item.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-ink">
                      <span className="font-medium">{item.name}</span>
                      <span className="flex items-center gap-2 tabular">
                        {Decimal.from(item.quantity).isZero() ? <Badge tone="danger">Tugagan</Badge> : null}
                        {formatQuantity(item.quantity, item.unit)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Spans both columns so the 3-card grid leaves no empty cell. */}
        <Card className="lg:col-span-2">
          <CardHeader title="Yaqindagi ombor harakatlari" icon={<History className="size-5" />} />
          {ledger.isError ? (
            <ErrorState error={ledger.error} collection onRetry={() => void ledger.refetch()} />
          ) : ledger.isPending ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : (
            <RecentMovements movements={ledger.data.movements.slice(0, 6)} />
          )}
        </Card>
      </div>

      <ExpensesPanel farm={farm} />
    </div>
  );
}
