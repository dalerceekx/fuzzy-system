import { Prisma } from '../generated/prisma/client.js';
import { StockMovementType } from '../generated/prisma/enums.js';

/** Scale of inventory_items.quantity / stock_movements.* (Decimal(14, 3)). */
export const QUANTITY_SCALE = 3;
/** Scale of money columns: unit_price / unit_cost (Decimal(16, 2)). */
export const PRICE_SCALE = 2;
/** Largest value Decimal(14, 3) can hold. */
export const MAX_STOCK_QUANTITY = new Prisma.Decimal('99999999999.999');

type DecimalInput = Prisma.Decimal | string;

const INBOUND: ReadonlySet<StockMovementType> = new Set([
  StockMovementType.IN,
  StockMovementType.ADJUSTMENT_IN,
]);

export type BalanceResult =
  | { ok: true; balance: Prisma.Decimal }
  | { ok: false; reason: 'INSUFFICIENT_STOCK' | 'STOCK_LIMIT_EXCEEDED' };

/**
 * New stock level after a movement, computed with Decimal arithmetic only
 * (never JS numbers). `quantity` is the validated, strictly positive amount.
 */
export function applyMovement(
  current: DecimalInput,
  type: StockMovementType,
  quantity: DecimalInput,
): BalanceResult {
  const amount = new Prisma.Decimal(quantity);
  const balance = INBOUND.has(type)
    ? new Prisma.Decimal(current).plus(amount)
    : new Prisma.Decimal(current).minus(amount);
  if (balance.lt(0)) return { ok: false, reason: 'INSUFFICIENT_STOCK' };
  if (balance.gt(MAX_STOCK_QUANTITY)) {
    return { ok: false, reason: 'STOCK_LIMIT_EXCEEDED' };
  }
  return { ok: true, balance };
}

export function isAdjustment(type: StockMovementType): boolean {
  return (
    type === StockMovementType.ADJUSTMENT_IN ||
    type === StockMovementType.ADJUSTMENT_OUT
  );
}

/** Fixed-scale decimal string for API responses (never exponent notation). */
export function decimalString(value: DecimalInput, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}
