const TIME_ZONE = 'Asia/Tashkent';

const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Tashkent as 'YYYY-MM-DD' (backend uses the same zone). */
export function todayInTashkent(now: Date = new Date()): string {
  return isoDateFormat.format(now);
}

/** 'YYYY-MM-DD' → { year, month, day } or null when malformed. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** Whole months between two calendar dates (b ≥ a), ignoring time zones. */
export function monthsBetween(from: string, to: string): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return null;
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day < a.day) months -= 1;
  return months;
}

/** 'YYYY-MM-DD' plus `days` calendar days. */
export function addDays(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) throw new RangeError(`Noto‘g‘ri sana: ${isoDate}`);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM' month key of an ISO timestamp in Tashkent time. */
export function monthKey(timestamp: string): string {
  return todayInTashkent(new Date(timestamp)).slice(0, 7);
}

const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const;

/** '2026-10' → 'Oktabr' (or 'Okt 2026' with the year). */
export function formatMonthShort(key: string, withYear = false): string {
  const [year, month] = key.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!name || !year) return key;
  return withYear ? `${name.slice(0, 3)} ${year}` : name;
}

/** '2026-10' → 'Oktabr 2026'. */
export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-');
  const name = MONTHS[Number(month) - 1];
  return name && year ? `${name} ${year}` : key;
}
