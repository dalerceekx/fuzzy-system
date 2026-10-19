import { truncate } from '../common/strings.js';
import type { StoredFileExtension } from '../storage/storage.types.js';

export const MAX_DISPLAY_NAME_LENGTH = 255;

// Control characters, plus bidi overrides/isolates and line separators that
// can disguise an extension in a UI (U+202E in "photo<U+202E>gpj.exe").
const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Display name for a stored file. It is only ever shown to the user or put
 * into Content-Disposition (encoded) — never used as a path. Directory parts
 * (both separators) are dropped, so the result never contains '/' or '\'.
 * May return '' (see sanitizeDisplayName for the fallback).
 */
export function cleanDisplayName(originalName: string | undefined): string {
  const base = (originalName ?? '').split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(UNSAFE_CHARS, '')
    .trim()
    .replace(/^\.+/, '');
  return truncate(cleaned, MAX_DISPLAY_NAME_LENGTH).trim();
}

/** cleanDisplayName with the `file.<ext>` fallback. */
export function sanitizeDisplayName(
  originalName: string | undefined,
  ext: StoredFileExtension,
): string {
  return cleanDisplayName(originalName) || `file.${ext}`;
}
