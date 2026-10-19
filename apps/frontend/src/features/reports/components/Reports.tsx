import { ChartColumn, PawPrint, Pill, ShoppingCart, Wallet, Warehouse } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { SPECIES, type Species } from '@/features/animals/api/animals.api';
import { AGE_CATEGORIES, AGE_CATEGORY_LABELS, ageCategory, SPECIES_LABELS } from '@/features/animals/lib/labels';
import { useAnimalCounts, useFarmAnimals } from '@/features/animals/model/animals.queries';
import { DateRangeFilter } from '@/features/expenses/components/DateRangeFilter';
import type { Farm } from '@/features/farms/api/farms.api';
import { INVENTORY_CATEGORIES, type InventoryUnit } from '@/features/inventory/api/inventory.api';
import { effectiveExpiry, EXPIRY_LABELS, expiryStatus, type ExpiryStatus } from '@/features/inventory/lib/expiry';
import { CATEGORY_LABELS, formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import {
  consumptionByMonth,
  inRange,
  lastMonthsRange,
  monthsInRange,
  normalizeRange,
  purchasesByCategory,
  purchasesByMonth,
  purchasesOf,
  sumAmounts,
  type DateRange,
} from '@/features/inventory/lib/ledger';
import { useInventoryItems, useLedger } from '@/features/inventory/model/inventory.queries';
import { Decimal } from '@/shared/lib/decimal';
import { formatMonthShort } from '@/shared/lib/dates';
import { formatCompact, formatDate, formatDecimal, formatInteger, formatMoney } from '@/shared/lib/format';
import { Alert, Badge, Card, CardBody, CardHeader, ErrorState, Field, Select, Skeleton } from '@/shared/ui';
import { BarChartView, BarList, ChartTable } from '@/shared/ui/charts';

function ReportCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} icon={icon} as="h2" />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full" />;
}

function NoData({ text = 'Tanlangan davr uchun ma’lumot yo‘q' }: { text?: string }) {
  return <p className="py-10 text-center text-ink-secondary">{text}</p>;
}

const moneyAxis = (value: number) => formatCompact(value);

/** Month names alone when the range stays within one year ("Oktabr"), else with the year. */
function monthLabel(key: string, months: string[]): string {
  const years = new Set(months.map((month) => month.slice(0, 4)));
  return formatMonthShort(key, years.size > 1);
}
const moneyTooltip = (value: number) => formatMoney(value.toFixed(2));
const countFormat = (value: number) => formatInteger(value);

function AnimalReports({ farm }: { farm: Farm }) {
  const counts = useAnimalCounts(farm.id);
  const animals = useFarmAnimals(farm.id);
  const [species, setSpecies] = useState<Species | ''>('');

  const speciesData = counts.bySpecies
    .filter((row) => row.count > 0)
    .map((row) => ({ label: SPECIES_LABELS[row.species], count: row.count }));
  const ageData = useMemo(() => {
    const items = (animals.data?.items ?? []).filter((animal) => !species || animal.species === species);
    return AGE_CATEGORIES.map((category) => ({
      label: AGE_CATEGORY_LABELS[category],
      count: items.filter((animal) => ageCategory(animal.birthDate) === category).length,
    }));
  }, [animals.data, species]);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ReportCard
        title="Hayvonlar turi bo‘yicha"
        description={`Jami: ${counts.total === undefined ? '—' : formatInteger(counts.total)} bosh`}
        icon={<PawPrint className="size-5" />}
      >
        {counts.error ? (
          <ErrorState error={counts.error} collection onRetry={counts.refetch} />
        ) : counts.isPending ? (
          <ChartSkeleton />
        ) : speciesData.length === 0 ? (
          <NoData text="Hali hayvon yo‘q" />
        ) : (
          <>
            <BarChartView
              label="Hayvonlar turi bo‘yicha soni"
              data={speciesData}
              categoryKey="label"
              series={[{ key: 'count', label: 'Bosh soni' }]}
              formatValue={countFormat}
            />
            <ChartTable
              caption="Hayvonlar turi bo‘yicha"
              headers={['Turi', 'Bosh soni']}
              rows={speciesData.map((row) => [row.label, formatInteger(row.count)])}
            />
          </>
        )}
      </ReportCard>

      <ReportCard title="Yosh toifalari" description="Tug‘ilgan sanasi bo‘yicha" icon={<PawPrint className="size-5" />}>
        <div className="mb-4 max-w-xs">
          <Field label="Hayvon turi">
            <Select value={species} onChange={(event) => setSpecies(event.target.value as Species | '')}>
              <option value="">Barcha turlar</option>
              {SPECIES.map((value) => (
                <option key={value} value={value}>
                  {SPECIES_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {animals.isError ? (
          <ErrorState error={animals.error} collection onRetry={() => void animals.refetch()} />
        ) : animals.isPending ? (
          <ChartSkeleton />
        ) : ageData.every((row) => row.count === 0) ? (
          <NoData text="Bu tur bo‘yicha hayvon yo‘q" />
        ) : (
          <>
            <BarChartView
              label="Yosh toifalari bo‘yicha soni"
              data={ageData}
              categoryKey="label"
              series={[{ key: 'count', label: 'Bosh soni' }]}
              formatValue={countFormat}
            />
            <ChartTable
              caption="Yosh toifalari"
              headers={['Toifa', 'Bosh soni']}
              rows={ageData.map((row) => [row.label, formatInteger(row.count)])}
            />
          </>
        )}
      </ReportCard>
    </div>
  );
}

function LedgerReports({ farm, range }: { farm: Farm; range: DateRange }) {
  const ledger = useLedger(farm.id);
  const months = useMemo(() => monthsInRange(range), [range]);
  const movements = useMemo(
    () => (ledger.data?.movements ?? []).filter((movement) => inRange(movement, range)),
    [ledger.data, range],
  );
  const purchases = useMemo(() => purchasesOf(movements), [movements]);
  const feedMovements = movements.filter((movement) => movement.item.category === 'FEED');
  const feedPurchases = purchases.filter((purchase) => purchase.movement.item.category === 'FEED');

  const consumption = consumptionByMonth(feedMovements, months);
  const units = [...new Set([...consumption.values()].flatMap((bucket) => [...bucket.keys()]))] as InventoryUnit[];
  const chartUnit: InventoryUnit | undefined = units.includes('KG') ? 'KG' : units[0];
  const consumptionData = months.map((key) => ({
    label: monthLabel(key, months),
    value: (consumption.get(key)?.get(chartUnit ?? 'KG') ?? Decimal.ZERO).toNumber(),
  }));

  const feedByMonth = purchasesByMonth(feedPurchases, months);
  const feedSpendData = months.map((key) => ({
    label: monthLabel(key, months),
    value: (feedByMonth.get(key)?.get('FEED') ?? Decimal.ZERO).toNumber(),
  }));

  const allByMonth = purchasesByMonth(purchases, months);
  const presentCategories = INVENTORY_CATEGORIES.filter((category) =>
    purchases.some((purchase) => purchase.movement.item.category === category),
  );
  const monthlyData = months.map((key) => {
    const bucket = allByMonth.get(key);
    const row: Record<string, string | number> = { label: monthLabel(key, months) };
    for (const category of presentCategories) row[category] = (bucket?.get(category) ?? Decimal.ZERO).toNumber();
    return row;
  });

  const byCategory = [...purchasesByCategory(purchases).entries()].sort((a, b) => b[1].compare(a[1]));
  const total = sumAmounts(purchases);

  if (ledger.isError) {
    return (
      <Card>
        <ErrorState error={ledger.error} collection onRetry={() => void ledger.refetch()} />
      </Card>
    );
  }

  const loading = ledger.isPending;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {ledger.data?.truncated ? (
        <Alert tone="warning" className="xl:col-span-2">
          Ombor tarixi juda katta — hisobotlar eng so‘nggi yozuvlar asosida tuzildi.
        </Alert>
      ) : null}

      <ReportCard
        title="Yem sarfi (oylik)"
        description={chartUnit ? `Chiqimlar, ${UNIT_SHORT[chartUnit]}` : 'Ombordan chiqarilgan yem'}
        icon={<Warehouse className="size-5" />}
      >
        {loading ? (
          <ChartSkeleton />
        ) : !chartUnit ? (
          <NoData />
        ) : (
          <>
            <BarChartView
              label="Oylik yem sarfi"
              data={consumptionData}
              categoryKey="label"
              series={[{ key: 'value', label: `Sarf, ${UNIT_SHORT[chartUnit]}` }]}
              formatValue={(value) => `${formatDecimal(value.toFixed(3))} ${UNIT_SHORT[chartUnit]}`}
            />
            <ChartTable
              caption="Oylik yem sarfi"
              headers={['Oy', ...units.map((unit) => `Sarf, ${UNIT_SHORT[unit]}`)]}
              rows={months.map((key) => [
                monthLabel(key, months),
                ...units.map((unit) => formatDecimal(consumption.get(key)?.get(unit) ?? Decimal.ZERO)),
              ])}
            />
          </>
        )}
      </ReportCard>

      <ReportCard
        title="Yem xaridi xarajatlari"
        description={`Jami: ${formatMoney(sumAmounts(feedPurchases))}`}
        icon={<ShoppingCart className="size-5" />}
      >
        {loading ? (
          <ChartSkeleton />
        ) : feedPurchases.length === 0 ? (
          <NoData />
        ) : (
          <>
            <BarChartView
              label="Oylik yem xaridi xarajatlari"
              data={feedSpendData}
              categoryKey="label"
              series={[{ key: 'value', label: 'Yem xaridi' }]}
              formatValue={moneyTooltip}
              formatAxis={moneyAxis}
            />
            <ChartTable
              caption="Oylik yem xaridi xarajatlari"
              headers={['Oy', 'Summa']}
              rows={months.map((key) => [
                monthLabel(key, months),
                formatMoney(feedByMonth.get(key)?.get('FEED') ?? Decimal.ZERO),
              ])}
            />
          </>
        )}
      </ReportCard>

      <ReportCard title="Oylik xarajatlar" description="Toifalar bo‘yicha ombor xaridlari" icon={<Wallet className="size-5" />}>
        {loading ? (
          <ChartSkeleton />
        ) : purchases.length === 0 ? (
          <NoData />
        ) : (
          <>
            <BarChartView
              label="Oylik xarajatlar toifalar bo‘yicha"
              data={monthlyData}
              categoryKey="label"
              series={presentCategories.map((category) => ({ key: category, label: CATEGORY_LABELS[category] }))}
              formatValue={moneyTooltip}
              formatAxis={moneyAxis}
              stacked
            />
            <ChartTable
              caption="Oylik xarajatlar"
              headers={['Oy', ...presentCategories.map((category) => CATEGORY_LABELS[category]), 'Jami']}
              rows={months.map((key) => {
                const bucket = allByMonth.get(key);
                const sum = Decimal.sum(presentCategories.map((category) => bucket?.get(category) ?? Decimal.ZERO));
                return [
                  monthLabel(key, months),
                  ...presentCategories.map((category) => formatMoney(bucket?.get(category) ?? Decimal.ZERO)),
                  formatMoney(sum),
                ];
              })}
            />
          </>
        )}
      </ReportCard>

      <ReportCard
        title="Xarajatlar taqsimoti"
        description={`Davr bo‘yicha jami: ${formatMoney(total)}`}
        icon={<ChartColumn className="size-5" />}
      >
        {loading ? (
          <ChartSkeleton />
        ) : byCategory.length === 0 ? (
          <NoData />
        ) : (
          <BarList
            label="Xarajatlar toifalar bo‘yicha"
            max={total.toNumber()}
            items={byCategory.map(([category, amount]) => {
              const share = total.isZero() ? Decimal.ZERO : amount.mul(Decimal.from(100)).div(total, 1);
              return {
                key: category,
                label: CATEGORY_LABELS[category],
                value: amount.toNumber(),
                display: `${formatMoney(amount)} · ${formatDecimal(share, { maxFractionDigits: 1 })}%`,
              };
            })}
          />
        )}
      </ReportCard>
    </div>
  );
}

const EXPIRY_TONE: Record<ExpiryStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  OK: 'success',
  SOON: 'warning',
  EXPIRED: 'danger',
  NONE: 'neutral',
};

function MedicineReport({ farm }: { farm: Farm }) {
  const items = useInventoryItems(farm.id, 'MEDICINE');
  const rows = (items.data?.items ?? []).map((item) => ({ item, status: expiryStatus(item) }));
  const attention = rows.filter((row) => row.status === 'SOON' || row.status === 'EXPIRED');
  return (
    <ReportCard title="Dori zaxirasi" description="Yaroqlilik muddati holati" icon={<Pill className="size-5" />}>
      {items.isError ? (
        <ErrorState error={items.error} collection onRetry={() => void items.refetch()} />
      ) : items.isPending ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <NoData text="Omborda dori yo‘q" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(['OK', 'SOON', 'EXPIRED', 'NONE'] as const).map((status) => (
              <Badge key={status} tone={EXPIRY_TONE[status]}>
                {EXPIRY_LABELS[status]}: {rows.filter((row) => row.status === status).length}
              </Badge>
            ))}
          </div>
          {attention.length > 0 ? (
            <ul className="divide-y divide-line rounded-[12px] border border-line">
              {attention.map(({ item, status }) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="font-medium">{item.name}</span>
                  <span className="flex items-center gap-2 text-sm text-ink-secondary">
                    {formatQuantity(item.quantity, item.unit)} · {formatDate(effectiveExpiry(item))}
                    <Badge tone={EXPIRY_TONE[status]}>{EXPIRY_LABELS[status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-secondary">Muddati yaqin yoki o‘tgan dori yo‘q.</p>
          )}
        </div>
      )}
    </ReportCard>
  );
}

export function Reports({ farm }: { farm: Farm }) {
  const [range, setRange] = useState<DateRange>(() => lastMonthsRange(6));
  const normalized = normalizeRange(range);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full max-w-md shrink-0">
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          <p className="text-sm text-ink-secondary">
            Ferma: <strong className="text-ink">{farm.name}</strong> (yuqoridagi ferma tanlagichi orqali almashtiriladi). Barcha
            raqamlar server ma’lumotlaridan hisoblangan.
          </p>
        </CardBody>
      </Card>
      <AnimalReports farm={farm} />
      <LedgerReports farm={farm} range={normalized} />
      <MedicineReport farm={farm} />
    </div>
  );
}
