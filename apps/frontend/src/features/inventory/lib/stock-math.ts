import { Decimal } from '@/shared/lib/decimal';
import { formatDecimal } from '@/shared/lib/format';
import type { InventoryItem, InventoryUnit } from '../api/inventory.api';
import { UNIT_SHORT } from './labels';

/** Sum of balances per unit (kg and litres are never added together). */
export function totalsByUnit(items: InventoryItem[]): Array<{ unit: InventoryUnit; total: Decimal }> {
  const totals = new Map<InventoryUnit, Decimal>();
  for (const item of items) {
    const quantity = Decimal.parse(item.quantity) ?? Decimal.ZERO;
    totals.set(item.unit, (totals.get(item.unit) ?? Decimal.ZERO).add(quantity));
  }
  return [...totals.entries()].map(([unit, total]) => ({ unit, total }));
}

export function formatTotals(totals: Array<{ unit: InventoryUnit; total: Decimal }>): string {
  if (totals.length === 0) return '0';
  return totals.map(({ unit, total }) => `${formatDecimal(total)} ${UNIT_SHORT[unit]}`).join(' · ');
}

/** quantity × unit price; null when the item has no price. */
export function stockValue(item: Pick<InventoryItem, 'quantity' | 'unitPrice'>): Decimal | null {
  const quantity = Decimal.parse(item.quantity);
  const price = Decimal.parse(item.unitPrice);
  return quantity && price ? quantity.mul(price).round(2) : null;
}

/** Nothing left, or at/below the farmer's minimum ("qoldiq nazorati"). */
export function isLowStock(item: Pick<InventoryItem, 'quantity' | 'minQuantity'>): boolean {
  const quantity = Decimal.parse(item.quantity) ?? Decimal.ZERO;
  if (quantity.isZero()) return true;
  const minimum = Decimal.parse(item.minQuantity);
  return minimum !== null && !quantity.gt(minimum);
}
