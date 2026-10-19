import { formatDecimal } from '@/shared/lib/format';
import type { InventoryCategory, InventoryUnit, MovementType } from '../api/inventory.api';

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  FEED: 'Yem',
  MEDICINE: 'Dori',
  EQUIPMENT: 'Jihoz',
  OTHER: 'Boshqa',
};

export const UNIT_SHORT: Record<InventoryUnit, string> = {
  KG: 'kg',
  G: 'g',
  L: 'l',
  ML: 'ml',
  PIECE: 'dona',
  DOSE: 'doza',
};

export const UNIT_NAMES: Record<InventoryUnit, string> = {
  KG: 'Kilogramm (kg)',
  G: 'Gramm (g)',
  L: 'Litr (l)',
  ML: 'Millilitr (ml)',
  PIECE: 'Dona',
  DOSE: 'Doza',
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  IN: 'Kirim',
  OUT: 'Chiqim',
  ADJUSTMENT_IN: 'Tuzatish (+)',
  ADJUSTMENT_OUT: 'Tuzatish (−)',
};

export function isIncoming(type: MovementType): boolean {
  return type === 'IN' || type === 'ADJUSTMENT_IN';
}

/** "1 250 kg", "12,5 l". */
export function formatQuantity(quantity: string | null | undefined, unit: InventoryUnit): string {
  const formatted = formatDecimal(quantity, { maxFractionDigits: 3 });
  return formatted === '—' ? formatted : `${formatted} ${UNIT_SHORT[unit]}`;
}
