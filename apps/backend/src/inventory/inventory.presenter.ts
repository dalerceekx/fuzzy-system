import { toDateOnly } from '../common/time.js';
import type {
  InventoryItem,
  Prisma,
  StockMovement,
} from '../generated/prisma/client.js';
import type {
  InventoryCategory,
  InventoryUnit,
  StockMovementType,
} from '../generated/prisma/enums.js';
import { decimalString, PRICE_SCALE, QUANTITY_SCALE } from './stock-balance.js';

export interface InventoryItemResponse {
  id: string;
  farmId: string;
  name: string;
  category: InventoryCategory;
  unit: InventoryUnit;
  /** Decimal string with 3 fraction digits, e.g. "12.500". */
  quantity: string;
  /** Price of one unit, 2 fraction digits ("3500.00"); null when unknown. */
  unitPrice: string | null;
  /** Low-stock threshold, 3 fraction digits; low when quantity <= it. */
  minQuantity: string | null;
  medicineId: string | null;
  batchNumber: string | null;
  /** 'YYYY-MM-DD' */
  expiresOn: string | null;
  openedAt: Date | null;
  useWithinDaysAfterOpening: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementResponse {
  id: string;
  itemId: string;
  farmId: string;
  type: StockMovementType;
  quantity: string;
  balanceAfter: string;
  unitCost: string | null;
  currency: string | null;
  reason: string | null;
  actorId: string;
  /** Set on the OUT movements written by a ration issue. */
  rationIssueId: string | null;
  createdAt: Date;
}

/** Fixed-scale string of an optional decimal column. */
export function optionalDecimalString(
  value: Prisma.Decimal | null,
  scale: number,
): string | null {
  return value === null ? null : decimalString(value, scale);
}

export function toItemResponse(item: InventoryItem): InventoryItemResponse {
  return {
    id: item.id,
    farmId: item.farmId,
    name: item.name,
    category: item.category,
    unit: item.unit,
    quantity: decimalString(item.quantity, QUANTITY_SCALE),
    unitPrice: optionalDecimalString(item.unitPrice, PRICE_SCALE),
    minQuantity: optionalDecimalString(item.minQuantity, QUANTITY_SCALE),
    medicineId: item.medicineId,
    batchNumber: item.batchNumber,
    expiresOn: item.expiresOn ? toDateOnly(item.expiresOn) : null,
    openedAt: item.openedAt,
    useWithinDaysAfterOpening: item.useWithinDaysAfterOpening,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toMovementResponse(
  movement: StockMovement,
): StockMovementResponse {
  return {
    id: movement.id,
    itemId: movement.itemId,
    farmId: movement.farmId,
    type: movement.type,
    quantity: decimalString(movement.quantity, QUANTITY_SCALE),
    balanceAfter: decimalString(movement.balanceAfter, QUANTITY_SCALE),
    unitCost: optionalDecimalString(movement.unitCost, PRICE_SCALE),
    currency: movement.currency,
    reason: movement.reason,
    actorId: movement.actorId,
    rationIssueId: movement.rationIssueId,
    createdAt: movement.createdAt,
  };
}
