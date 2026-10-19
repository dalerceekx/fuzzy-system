import { randomUUID } from 'node:crypto';

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

export type StoredFileExtension = 'jpg' | 'png' | 'webp' | 'pdf';

export const STORED_FILE_EXTENSIONS: readonly StoredFileExtension[] =
  Object.freeze(['jpg', 'png', 'webp', 'pdf']);

export interface SignedDownloadOptions {
  expiresInSeconds: number;
  /** Display name for Content-Disposition (never used as a path). */
  downloadName: string;
  contentType: string;
}

export interface StorageDriver {
  readonly kind: 's3' | 'local';
  /** Never overwrites an existing key (rejects instead). */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  /** Presigned GET URL (s3); `null` when the driver cannot sign (local). */
  getSignedDownloadUrl(
    key: string,
    opts: SignedDownloadOptions,
  ): Promise<string | null>;
  healthCheck(): Promise<void>;
}

/** Same rule as the `stored_files_storage_key_chk` CHECK constraint. */
export const STORAGE_KEY_PATTERN =
  /^[a-z0-9]+(\/[a-z0-9-]+)*\.(jpg|png|webp|pdf)$/;
const MAX_KEY_LENGTH = 255;

export class UnsafeStorageKeyError extends Error {
  constructor() {
    super('Unsafe storage key');
    this.name = 'UnsafeStorageKeyError';
  }
}

/** Rejects traversal ('..'), absolute paths, backslashes and any other shape. */
export function assertSafeStorageKey(key: string): void {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    key.includes('..') ||
    !STORAGE_KEY_PATTERN.test(key)
  ) {
    throw new UnsafeStorageKeyError();
  }
}

/** Server-generated key: `files/<yyyy>/<mm>/<uuid-v4>.<ext>` (UTC date). */
export function buildStorageKey(
  ext: StoredFileExtension,
  now: Date = new Date(),
): string {
  if (!STORED_FILE_EXTENSIONS.includes(ext)) throw new UnsafeStorageKeyError();
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const key = `files/${year}/${month}/${randomUUID()}.${ext}`;
  assertSafeStorageKey(key);
  return key;
}

/** RFC 5987/6266 attachment header value for a (sanitized) display name. */
export function attachmentContentDisposition(downloadName: string): string {
  const encoded = encodeURIComponent(downloadName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}
