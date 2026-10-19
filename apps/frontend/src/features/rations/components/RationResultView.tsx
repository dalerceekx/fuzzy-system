import type { ReactNode } from 'react';
import { formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import { Decimal } from '@/shared/lib/decimal';
import { formatDecimal, formatInteger, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui';
import { calculateRation, type NamedRationLine, type UnitTotal } from '../lib/ration-math';

export type ResultLine = NamedRationLine;

const totals = (values: UnitTotal[]) =>
  values.length === 0 ? '—' : values.map(({ unit, total }) => formatQuantity(total.toString(), unit)).join(' · ');

function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink-secondary">
        {label}
      </th>
      <td className={strong ? 'py-2.5 text-right text-lg font-semibold text-ink tabular' : 'py-2.5 text-right text-ink tabular'}>
        {value}
      </td>
    </tr>
  );
}

/**
 * "Ratsion natijalari" (spec 5): the summary table, the per-feed breakdown
 * and daily / weekly / monthly costs. Pure presentation of calculateRation.
 */
export function RationResultView({
  typeName,
  animalCount,
  days,
  lines,
}: {
  typeName: string;
  animalCount: number;
  days: number;
  lines: ResultLine[];
}) {
  const result = calculateRation({ animalCount: Decimal.from(animalCount), days: Decimal.from(days), lines });
  const daysLabel = `${formatInteger(days)} kunlik`;
  const costs: Array<[string, Decimal]> = [
    ['Kunlik', result.dailyCost],
    ['Haftalik', result.dailyCost.mul(Decimal.from(7))],
    ['Oylik (30 kun)', result.dailyCost.mul(Decimal.from(30))],
  ];

  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">Ratsion natijalari</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Ko‘rsatkich</th>
            <th scope="col">Natija</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Hayvon turi" value={typeName} />
          <Row label="Hayvonlar soni" value={`${formatInteger(animalCount)} ta`} />
          <Row label="Oziqlantirish muddati" value={`${formatInteger(days)} kun`} />
          <Row label="Kunlik yem sarfi" value={totals(result.dailyByUnit)} />
          <Row label={`${daysLabel} yem sarfi`} value={totals(result.periodByUnit)} strong />
          <Row label="Kunlik xarajat" value={formatMoney(result.dailyCost)} />
          <Row label="Umumiy xarajat" value={formatMoney(result.periodCost)} strong />
          <Row
            label="Ombor holati"
            value={result.sufficient ? <Badge tone="success">Yetarli</Badge> : <Badge tone="danger">Yetarli emas</Badge>}
          />
        </tbody>
      </table>

      {result.unpricedLines > 0 ? (
        <p className="rounded-[10px] bg-warning-light px-3 py-2 text-sm text-warning">
          {result.unpricedLines} ta yemning 1 kg narxi kiritilmagan — xarajatga qo‘shilmadi.
        </p>
      ) : null}

      <section aria-label="Xarajatlar">
        <h3 className="mb-2 font-semibold text-ink">Xarajatlar</h3>
        <dl className="grid grid-cols-3 gap-2.5">
          {costs.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-[14px] border border-line bg-background px-3 py-2.5">
              <dt className="text-[13px] text-ink-secondary">{label}</dt>
              <dd className="mt-0.5 font-semibold break-words text-ink tabular">{formatMoney(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Yemlar bo‘yicha" className="overflow-x-auto">
        <h3 className="mb-2 font-semibold text-ink">Yemlar bo‘yicha</h3>
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <caption className="sr-only">Yemlar bo‘yicha hisob</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-secondary">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Yem
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Bir boshga/kun
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Kunlik
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                {daysLabel}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Omborda
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Holat
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Xarajat
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const calc = result.lines[index];
              if (!calc) return null;
              const unit = UNIT_SHORT[line.unit];
              return (
                <tr key={`${line.name}-${index}`} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-2 pr-3 font-medium whitespace-nowrap text-ink">
                    {line.name}
                  </th>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular">
                    {formatDecimal(line.dailyPerAnimal)} {unit}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular">
                    {formatDecimal(calc.daily)} {unit}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular">
                    {formatDecimal(calc.period)} {unit}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular">
                    {formatDecimal(line.stock)} {unit}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {calc.sufficient ? (
                      <Badge tone="success">
                        Yetarli · qoladi {formatDecimal(calc.remaining)} {unit}
                      </Badge>
                    ) : (
                      <Badge tone="danger">
                        {formatDecimal(calc.shortage)} {unit} yetishmaydi
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap tabular">
                    {calc.periodCost ? formatMoney(calc.periodCost) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
