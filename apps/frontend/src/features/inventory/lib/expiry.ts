import { addDays, todayInTashkent } from '@/shared/lib/dates';
import type { InventoryItem } from '../api/inventory.api';

export type ExpiryStatus = 'NONE' | 'OK' | 'SOON' | 'EXPIRED';

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  NONE: 'Muddat ko‘rsatilmagan',
  OK: 'Yaroqli',
  SOON: 'Muddati yaqin',
  EXPIRED: 'Muddati o‘tgan',
};

const SOON_DAYS = 30;

/**
 * Effective last usable day: the label expiry date, or the "use within N
 * days after opening" limit if that comes first (both entered by the farmer).
 */
export function effectiveExpiry(
  item: Pick<InventoryItem, 'expiresOn' | 'openedAt' | 'useWithinDaysAfterOpening'>,
): string | null {
  const candidates: string[] = [];
  if (item.expiresOn) candidates.push(item.expiresOn);
  if (item.openedAt && item.useWithinDaysAfterOpening) {
    candidates.push(addDays(todayInTashkent(new Date(item.openedAt)), item.useWithinDaysAfterOpening));
  }
  return candidates.sort()[0] ?? null;
}

export function expiryStatus(
  item: Pick<InventoryItem, 'expiresOn' | 'openedAt' | 'useWithinDaysAfterOpening'>,
  today = todayInTashkent(),
): ExpiryStatus {
  const last = effectiveExpiry(item);
  if (!last) return 'NONE';
  if (last < today) return 'EXPIRED';
  if (last <= addDays(today, SOON_DAYS)) return 'SOON';
  return 'OK';
}
