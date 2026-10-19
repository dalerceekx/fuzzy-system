// C0 and C1 control characters except TAB (\x09) and LF (\x0A).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** Trims, NFC-normalizes and strips control characters except \n and \t. */
export function sanitizeText(input: string): string {
  return input.normalize('NFC').replace(CONTROL_CHARS, '').trim();
}

/** Truncates to `max` UTF-16 code units without splitting a surrogate pair. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

/** `truncate` for optional values; empty strings become undefined. */
export function truncateOptional(
  value: string | null | undefined,
  max: number,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return truncate(value, max);
}
