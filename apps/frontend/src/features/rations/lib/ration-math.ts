import type { InventoryUnit } from '@/features/inventory/api/inventory.api';
import { Decimal } from '@/shared/lib/decimal';
import type { Ration } from '../api/rations.api';

/** One feed of a ration, with what the warehouse knows about it. */
export interface RationLineInput {
  /** Per animal per day, in the item unit. */
  dailyPerAnimal: Decimal;
  unit: InventoryUnit;
  /** Warehouse balance in the same unit. */
  stock: Decimal;
  /** Price of one unit (so‘m); null when the item has no price. */
  unitPrice: Decimal | null;
}

export interface NamedRationLine extends RationLineInput {
  name: string;
}

/** A saved ration's lines with the current warehouse balance and price. */
export function rationLines(ration: Pick<Ration, 'items'>): NamedRationLine[] {
  return ration.items.map((line) => ({
    name: line.item.name,
    unit: line.item.unit,
    dailyPerAnimal: Decimal.from(line.dailyPerAnimal),
    stock: Decimal.parse(line.item.quantity) ?? Decimal.ZERO,
    unitPrice: Decimal.parse(line.item.unitPrice),
  }));
}

/** Current daily cost and warehouse sufficiency of a saved ration. */
export function summarizeRation(ration: Pick<Ration, 'items' | 'animalCount' | 'days'>): RationResult {
  return calculateRation({
    animalCount: Decimal.from(ration.animalCount),
    days: Decimal.from(ration.days),
    lines: rationLines(ration),
  });
}

export interface RationLineResult {
  /** dailyPerAnimal × animals. */
  daily: Decimal;
  /** daily × days. */
  period: Decimal;
  /** daily × unitPrice (2 dp); null without a price. */
  dailyCost: Decimal | null;
  periodCost: Decimal | null;
  sufficient: boolean;
  /** Missing amount for the whole period (0 when sufficient). */
  shortage: Decimal;
  /** Balance left after the period (0 when short): stock − period. */
  remaining: Decimal;
  /** Whole days the stock lasts at this daily amount. */
  daysCovered: Decimal | null;
}

export interface UnitTotal {
  unit: InventoryUnit;
  total: Decimal;
}

export interface RationResult {
  lines: RationLineResult[];
  dailyByUnit: UnitTotal[];
  periodByUnit: UnitTotal[];
  /** Sum over the lines that have a price. */
  dailyCost: Decimal;
  periodCost: Decimal;
  /** Lines left out of the costs because the feed has no price. */
  unpricedLines: number;
  /** Every feed covers the whole period. */
  sufficient: boolean;
}

function byUnit(lines: Array<{ unit: InventoryUnit; value: Decimal }>): UnitTotal[] {
  const totals = new Map<InventoryUnit, Decimal>();
  for (const { unit, value } of lines) totals.set(unit, (totals.get(unit) ?? Decimal.ZERO).add(value));
  return [...totals.entries()].map(([unit, total]) => ({ unit, total }));
}

function floorDays(value: Decimal): Decimal {
  const [integerPart = '0'] = value.toFixed(3).split('.');
  return Decimal.from(integerPart);
}

/**
 * The ration arithmetic, Decimal only:
 * daily = per-animal × animals; period = daily × days; costs = amount × price;
 * remaining = stock − period. No feeding norms are assumed — every amount
 * comes from the farmer.
 */
export function calculateRation({
  animalCount,
  days,
  lines,
}: {
  animalCount: Decimal;
  days: Decimal;
  lines: RationLineInput[];
}): RationResult {
  const results = lines.map((line): RationLineResult => {
    const daily = line.dailyPerAnimal.mul(animalCount);
    const period = daily.mul(days);
    const sufficient = line.stock.gte(period);
    return {
      daily,
      period,
      dailyCost: line.unitPrice ? daily.mul(line.unitPrice).round(2) : null,
      periodCost: line.unitPrice ? period.mul(line.unitPrice).round(2) : null,
      sufficient,
      shortage: sufficient ? Decimal.ZERO : period.sub(line.stock),
      remaining: sufficient ? line.stock.sub(period) : Decimal.ZERO,
      daysCovered: daily.isZero() ? null : floorDays(line.stock.div(daily, 3)),
    };
  });
  return {
    lines: results,
    dailyByUnit: byUnit(results.map((result, index) => ({ unit: lines[index]?.unit ?? 'KG', value: result.daily }))),
    periodByUnit: byUnit(results.map((result, index) => ({ unit: lines[index]?.unit ?? 'KG', value: result.period }))),
    dailyCost: Decimal.sum(results.flatMap((result) => (result.dailyCost ? [result.dailyCost] : []))),
    periodCost: Decimal.sum(results.flatMap((result) => (result.periodCost ? [result.periodCost] : []))),
    unpricedLines: results.filter((result) => result.dailyCost === null).length,
    sufficient: results.every((result) => result.sufficient),
  };
}

/** Amount one issue of `days` feeding days takes from the warehouse (per feed). */
export function issueAmount(dailyPerAnimal: Decimal, animalCount: Decimal, days: Decimal): Decimal {
  return dailyPerAnimal.mul(animalCount).mul(days);
}
