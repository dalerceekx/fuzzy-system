import { Decimal } from './decimal';

/** No-break space: groups digits without letting numbers wrap. */
export const GROUP_SEPARATOR = ' ';
const DECIMAL_SEPARATOR = ',';
const TIME_ZONE = 'Asia/Tashkent';

export const CURRENCY_LABEL = 'so‘m';

function groupDigits(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

interface NumberFormatOptions {
  /** Upper bound of fraction digits (rounded half-up). */
  maxFractionDigits?: number;
  /** Always show at least this many fraction digits. */
  minFractionDigits?: number;
}

/** "2400" → "2 400", "1234.5" → "1 234,5" (Uzbek grouping, decimal comma). */
export function formatDecimal(
  value: Decimal | string | number | null | undefined,
  { maxFractionDigits = 3, minFractionDigits = 0 }: NumberFormatOptions = {},
): string {
  if (value === null || value === undefined) return '—';
  const decimal = value instanceof Decimal ? value : typeof value === 'number' ? Decimal.from(value) : Decimal.parse(value);
  if (!decimal) return '—';
  const rounded = decimal.round(maxFractionDigits);
  const scale = Math.max(minFractionDigits, rounded.significantScale());
  const plain = rounded.toFixed(scale);
  const negative = plain.startsWith('-');
  const [integerPart = '0', fractionPart] = (negative ? plain.slice(1) : plain).split('.');
  const grouped = groupDigits(integerPart);
  return `${negative ? '-' : ''}${grouped}${fractionPart ? DECIMAL_SEPARATOR + fractionPart : ''}`;
}

/** "6000000" → "6 000 000 so‘m". Amounts are UZS. */
export function formatMoney(value: Decimal | string | number | null | undefined): string {
  const formatted = formatDecimal(value, { maxFractionDigits: 2 });
  return formatted === '—' ? formatted : `${formatted} ${CURRENCY_LABEL}`;
}

/** Short axis labels: 6 500 000 → "6,5 mln", 12 000 → "12 ming". Display only. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const scaled = (divisor: number, suffix: string) =>
    `${formatDecimal((Math.round((value / divisor) * 10) / 10).toFixed(1), { maxFractionDigits: 1 })} ${suffix}`;
  if (abs >= 1e9) return scaled(1e9, 'mlrd');
  if (abs >= 1e6) return scaled(1e6, 'mln');
  if (abs >= 1e4) return scaled(1e3, 'ming');
  return formatDecimal(Math.round(value));
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatDecimal(Math.trunc(value));
}

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partsOf(date: Date): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of dateParts.formatToParts(date)) result[part.type] = part.value;
  return result;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-10-16" (calendar date) → "16.10.2026". Date-only values are shown
 * as-is (no time-zone shift); timestamps are shown in Tashkent time.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const p = partsOf(date);
  return `${p.day}.${p.month}.${p.year}`;
}

/** ISO timestamp → "16.10.2026, 18:56" (Tashkent time). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const p = partsOf(date);
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

/** Up to two initials for avatars: "Demo Fermer" → "DF". */
export function initials(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toLocaleUpperCase('uz'));
  return letters.join('') || '?';
}
