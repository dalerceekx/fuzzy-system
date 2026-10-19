export const BUSINESS_TIME_ZONE = 'Asia/Tashkent';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const tashkentDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date ('YYYY-MM-DD') in Asia/Tashkent at `now`. */
export function todayInTashkent(now: Date = new Date()): string {
  const parts = tashkentDateFormat.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Strictly parses 'YYYY-MM-DD' (rejects impossible dates like 02-30). */
export function isValidDateOnly(isoDate: string): boolean {
  const match = DATE_ONLY.exec(isoDate);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** 'YYYY-MM-DD' → Date at 00:00:00Z (the representation of @db.Date). */
export function dateOnlyToDate(isoDate: string): Date {
  if (!isValidDateOnly(isoDate)) {
    throw new RangeError(`Invalid date-only value: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Date (from a @db.Date column) → 'YYYY-MM-DD'. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Date-only arithmetic on 'YYYY-MM-DD' (no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  return toDateOnly(
    new Date(dateOnlyToDate(isoDate).getTime() + days * DAY_MS),
  );
}

/** Seconds until the next calendar day starts in Asia/Tashkent (≥ 1). */
export function secondsUntilNextTashkentDay(now: Date = new Date()): number {
  const tomorrow = addDays(todayInTashkent(now), 1);
  // Tashkent is UTC+5 all year (no DST).
  const nextMidnight = dateOnlyToDate(tomorrow).getTime() - 5 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}
