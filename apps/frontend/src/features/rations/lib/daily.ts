import { todayInTashkent } from '@/shared/lib/dates';
import type { Ration } from '../api/rations.api';

/** 'YYYY-MM-DD' shifted by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface DailyStatus {
  /** Today's feeding has been taken from the warehouse. */
  given: boolean;
  /** Last day covered by the latest issue ('YYYY-MM-DD'); null when never issued. */
  coveredUntil: string | null;
  /** When the latest issue was recorded. */
  issuedAt: string | null;
}

/**
 * An issue of N feeding days counts as "given" from its own date
 * (Tashkent) for N days: a 1-day issue covers that day only.
 */
export function dailyStatus(ration: Pick<Ration, 'lastIssue'>, today = todayInTashkent()): DailyStatus {
  const last = ration.lastIssue;
  if (!last) return { given: false, coveredUntil: null, issuedAt: null };
  const from = todayInTashkent(new Date(last.createdAt));
  const coveredUntil = addDays(from, last.days - 1);
  return { given: from <= today && today <= coveredUntil, coveredUntil, issuedAt: last.createdAt };
}
