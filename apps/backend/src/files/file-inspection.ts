import { fileTypeFromBuffer } from 'file-type';
import type { StoredFileExtension } from '../storage/storage.types.js';

export interface AllowedFileType {
  ext: StoredFileExtension;
  mime: string;
  /** Accepted (lower-case) extensions of the client-side file name. */
  nameExtensions: readonly string[];
}

export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = Object.freeze([
  { ext: 'jpg', mime: 'image/jpeg', nameExtensions: ['jpg', 'jpeg'] },
  { ext: 'png', mime: 'image/png', nameExtensions: ['png'] },
  { ext: 'webp', mime: 'image/webp', nameExtensions: ['webp'] },
  { ext: 'pdf', mime: 'application/pdf', nameExtensions: ['pdf'] },
]);

export type FileRejectionReason =
  | 'active_content'
  | 'extension_not_allowed'
  | 'mime_not_allowed'
  | 'content_not_allowed'
  | 'type_mismatch';

export type FileInspection =
  | { ok: true; type: AllowedFileType }
  | {
      ok: false;
      reason: FileRejectionReason;
      detectedMime: string | null;
    };

const SNIFF_BYTES = 1024;
const ACTIVE_MARKUP = ['<svg', '<!doctype html', '<html', '<script'];
const EXECUTABLE_PREFIXES = ['mz', '\x7felf', '#!'];
// UTF-8 / UTF-16 / UTF-32 byte order marks and whitespace (as latin1 chars).
// eslint-disable-next-line no-control-regex
const LEADING_NOISE = /^(?:\xef\xbb\xbf|\xfe\xff|\xff\xfe|[\s\x00])+/;

/**
 * True when the head of the file looks like SVG/HTML/script or an
 * executable. Checked independently of the detected type, so a polyglot
 * (valid PNG header followed by markup) or a renamed binary is refused even
 * though its magic bytes are allowlisted: browsers and other consumers sniff
 * content, so such a file must never be stored.
 */
export function hasActiveContent(buffer: Buffer): boolean {
  // latin1 maps every byte to one char; NULs are dropped so UTF-16 encoded
  // markup ("<\0h\0t\0m\0l\0") is caught too.
  const head = buffer
    .subarray(0, SNIFF_BYTES)
    .toString('latin1')
    .toLowerCase()
    .replace(LEADING_NOISE, '');
  if (EXECUTABLE_PREFIXES.some((prefix) => head.startsWith(prefix))) {
    return true;
  }
  const text = head.replaceAll('\x00', '');
  return ACTIVE_MARKUP.some((marker) => text.includes(marker));
}

/** Last extension of the client file name, lower-cased ('' if none). */
export function nameExtension(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 'Image/PNG; charset=x' → 'image/png'. */
export function normalizeMime(declared: string | undefined): string {
  return (declared ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Four independent checks that must all pass and agree: file name
 * extension, declared MIME type, magic bytes (file-type), plus the active
 * content sniff above.
 */
export async function inspectUpload(input: {
  buffer: Buffer;
  originalName: string;
  declaredMime: string | undefined;
}): Promise<FileInspection> {
  const detected = await fileTypeFromBuffer(input.buffer);
  const detectedMime = detected?.mime ?? null;
  const reject = (reason: FileRejectionReason): FileInspection => ({
    ok: false,
    reason,
    detectedMime,
  });

  if (hasActiveContent(input.buffer)) return reject('active_content');

  const extension = nameExtension(input.originalName);
  const byName = ALLOWED_FILE_TYPES.find((type) =>
    type.nameExtensions.includes(extension),
  );
  if (!byName) return reject('extension_not_allowed');

  const declaredMime = normalizeMime(input.declaredMime);
  const byMime = ALLOWED_FILE_TYPES.find((type) => type.mime === declaredMime);
  if (!byMime) return reject('mime_not_allowed');

  const byContent = ALLOWED_FILE_TYPES.find(
    (type) => type.mime === detectedMime,
  );
  if (!byContent) return reject('content_not_allowed');

  if (byName !== byContent || byMime !== byContent) {
    return reject('type_mismatch');
  }
  return { ok: true, type: byContent };
}
