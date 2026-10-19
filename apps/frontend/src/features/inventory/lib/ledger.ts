import { Decimal } from '@/shared/lib/decimal';
import { monthKey, todayInTashkent } from '@/shared/lib/dates';
import type { InventoryCategory, InventoryUnit } from '../api/inventory.api';
import type { LedgerMovement } from '../model/inventory.queries';

export interface DateRange {
  /** 'YYYY-MM-DD', inclusive (Tashkent calendar). */
  from: string;
  to: string;
}

export function movementDate(movement: Pick<LedgerMovement, 'createdAt'>): string {
  return todayInTashkent(new Date(movement.createdAt));
}

export function inRange(movement: Pick<LedgerMovement, 'createdAt'>, range: DateRange): boolean {
  const date = movementDate(movement);
  return date >= range.from && date <= range.to;
}

/** First day of the current month → today (Tashkent). */
export function currentMonthRange(today = todayInTashkent()): DateRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The last `months` calendar months including the current one. */
export function lastMonthsRange(months: number, today = todayInTashkent()): DateRange {
  const [year = 0, month = 1] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - (months - 1), 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}

/** 'YYYY-MM' keys from range start to end, inclusive. */
export function monthsInRange(range: DateRange): string[] {
  const keys: string[] = [];
  let cursor = `${range.from.slice(0, 7)}-01`;
  const last = range.to.slice(0, 7);
  while (cursor.slice(0, 7) <= last && keys.length < 120) {
    keys.push(cursor.slice(0, 7));
    const [year = 0, month = 1] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  return keys;
}

export interface Purchase {
  movement: LedgerMovement;
  /** quantity × unitCost, exact. */
  amount: Decimal;
}

/**
 * Spending the backend can actually prove: stock intakes (IN) recorded with
 * a unit cost. Movements without a price are never valued.
 */
export function purchasesOf(movements: LedgerMovement[]): Purchase[] {
  return movements
    .filter((movement) => movement.type === 'IN' && movement.unitCost !== null)
    .map((movement) => ({
      movement,
      amount: Decimal.from(movement.quantity)
        .mul(Decimal.from(movement.unitCost ?? '0'))
        .round(2),
    }));
}

export function sumAmounts(purchases: Purchase[]): Decimal {
  return Decimal.sum(purchases.map((purchase) => purchase.amount));
}

/** month → category → amount. */
export function purchasesByMonth(purchases: Purchase[], months: string[]): Map<string, Map<InventoryCategory, Decimal>> {
  const result = new Map(months.map((key) => [key, new Map<InventoryCategory, Decimal>()]));
  for (const purchase of purchases) {
    const bucket = result.get(monthKey(purchase.movement.createdAt));
    if (!bucket) continue;
    const category = purchase.movement.item.category;
    bucket.set(category, (bucket.get(category) ?? Decimal.ZERO).add(purchase.amount));
  }
  return result;
}

export function purchasesByCategory(purchases: Purchase[]): Map<InventoryCategory, Decimal> {
  const result = new Map<InventoryCategory, Decimal>();
  for (const purchase of purchases) {
    const category = purchase.movement.item.category;
    result.set(category, (result.get(category) ?? Decimal.ZERO).add(purchase.amount));
  }
  return result;
}

/** Consumption (OUT only — adjustments are corrections, not use), month → unit → quantity. */
export function consumptionByMonth(movements: LedgerMovement[], months: string[]): Map<string, Map<InventoryUnit, Decimal>> {
  const result = new Map(months.map((key) => [key, new Map<InventoryUnit, Decimal>()]));
  for (const movement of movements) {
    if (movement.type !== 'OUT') continue;
    const bucket = result.get(monthKey(movement.createdAt));
    if (!bucket) continue;
    const unit = movement.item.unit;
    bucket.set(unit, (bucket.get(unit) ?? Decimal.ZERO).add(Decimal.from(movement.quantity)));
  }
  return result;
}

/** Inclusive range check helper for date inputs (from ≤ to, both valid). */
export function normalizeRange(range: DateRange): DateRange {
  return range.from <= range.to ? range : { from: range.to, to: range.from };
}
