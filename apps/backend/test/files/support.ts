import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Test } from 'supertest';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { LocalStorageDriver } from '../../src/storage/local-storage.driver.js';
import type {
  SignedDownloadOptions,
  StorageDriver,
} from '../../src/storage/storage.types.js';
import type { TestApp } from '../utils/app.js';
import { loginAs, type LoggedIn } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';

export const FILES_URL = '/api/v1/files';

/** Server-generated key layout (see buildStorageKey). */
export const STORAGE_KEY_SHAPE =
  /^files\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

export function uploadDir(): string {
  const dir = process.env.UPLOAD_LOCAL_DIR;
  if (!dir) throw new Error('UPLOAD_LOCAL_DIR is not set');
  return dir;
}

/** Every regular file below `dir`, as paths relative to it. */
export function listFilesRecursive(dir: string = uploadDir()): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out.sort();
}

export function readStoredObject(storageKey: string): Buffer {
  return readFileSync(join(uploadDir(), storageKey));
}

export interface MultipartPart {
  name: string;
  /** Raw filename parameter (sent byte for byte, not normalized). */
  filename?: string;
  /** Extra raw Content-Disposition parameters, e.g. `filename*=UTF-8''…`. */
  dispositionExtra?: string;
  contentType?: string;
  body: Buffer | string;
}

/**
 * Hand-built multipart body: unlike supertest's attach(), the file name is
 * sent exactly as given (form-data would apply path.basename to it).
 */
export function multipart(parts: MultipartPart[]): {
  contentType: string;
  body: Buffer;
} {
  const boundary = `----mf-test-${randomBytes(8).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let disposition = `form-data; name="${part.name}"`;
    if (part.filename !== undefined) {
      disposition += `; filename="${part.filename}"`;
    }
    if (part.dispositionExtra) disposition += `; ${part.dispositionExtra}`;
    let head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n`;
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`, 'utf8'));
    chunks.push(
      Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body),
    );
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

export interface UploadOptions {
  filename: string;
  contentType?: string;
  fields?: Record<string, string>;
}

/** POST /files with a single `file` part (plus optional text fields). */
export function uploadFile(
  testApp: TestApp,
  auth: LoggedIn,
  body: Buffer,
  options: UploadOptions,
): Test {
  const form = multipart([
    ...Object.entries(options.fields ?? {}).map(([name, value]) => ({
      name,
      body: value,
    })),
    {
      name: 'file',
      filename: options.filename,
      contentType: options.contentType,
      body,
    },
  ]);
  return sendMultipart(testApp, auth, form);
}

export function sendMultipart(
  testApp: TestApp,
  auth: LoggedIn,
  form: { contentType: string; body: Buffer },
): Test {
  return testApp
    .http()
    .post(FILES_URL)
    .set(auth.authHeader)
    .set('Content-Type', form.contentType)
    .send(form.body);
}

export async function createLoggedInUser(
  testApp: TestApp,
  role: UserRole = UserRole.FARMER,
) {
  const { user } = await createUser(testApp.prisma, { role });
  return { user, auth: await loginAs(testApp, user) };
}

/** Rows of this owner (including soft-deleted ones). */
export function storedFilesOf(testApp: TestApp, ownerId: string) {
  return testApp.prisma.storedFile.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'asc' },
  });
}

export function rejectionAuditsOf(testApp: TestApp, actorId: string) {
  return testApp.prisma.auditLog.findMany({
    where: { actorId, action: 'file.rejected' },
    orderBy: { timestamp: 'asc' },
  });
}

/**
 * Local storage that pretends to be S3 for the signed-URL endpoint and can
 * be told to fail writes (storage outage).
 */
export class TestStorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  failPuts = false;
  readonly signed: Array<{ key: string; opts: SignedDownloadOptions }> = [];
  private readonly local = new LocalStorageDriver(uploadDir());

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPuts) {
      return Promise.reject(
        Object.assign(new Error('simulated outage'), { name: 'TimeoutError' }),
      );
    }
    return this.local.put(key, body, contentType);
  }

  getStream(key: string): Promise<NodeJS.ReadableStream> {
    return this.local.getStream(key);
  }

  delete(key: string): Promise<void> {
    return this.local.delete(key);
  }

  getSignedDownloadUrl(
    key: string,
    opts: SignedDownloadOptions,
  ): Promise<string | null> {
    this.signed.push({ key, opts });
    return Promise.resolve(
      `https://storage.test.invalid/${key}?X-Amz-Expires=${opts.expiresInSeconds}`,
    );
  }

  healthCheck(): Promise<void> {
    return this.local.healthCheck();
  }
}
