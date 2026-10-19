import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { plainPng } from '../fixtures/files/fixtures.js';
import {
  createLoggedInUser,
  FILES_URL,
  listFilesRecursive,
  multipart,
  sendMultipart,
  STORAGE_KEY_SHAPE,
  storedFilesOf,
  uploadDir,
  uploadFile,
} from '../files/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import type { LoggedIn } from '../utils/auth.js';

// Uploads never choose a path: the storage key is generated server-side and
// the client file name is reduced to a display name. Route ids are UUIDs.

describe('Security: path traversal in uploads and file routes', () => {
  let testApp: TestApp;
  let auth: LoggedIn;
  let userId: string;
  // Unique per run, so stray files from this test can be searched for.
  const marker = `mf-traversal-${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['files'] });
    const created = await createLoggedInUser(testApp);
    auth = created.auth;
    userId = created.user.id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  const traversalNames = [
    `../../${marker}-a.png`,
    `../../../../../../tmp/${marker}-b.png`,
    `/etc/${marker}-c.png`,
    `..\\..\\${marker}-d.png`,
    `C:\\Windows\\${marker}-e.png`,
    `%2e%2e%2f%2e%2e%2f${marker}-f.png`,
    `..%2F..%2F${marker}-g.png`,
    `%2e%2e%5c%2e%2e%5c${marker}-h.png`,
    `....//....//${marker}-i.png`,
    `files/2026/10/${marker}-j.png`,
  ];

  it.each(traversalNames)(
    'stores %j under a generated key with a sanitized display name',
    async (filename) => {
      const res = await uploadFile(testApp, auth, plainPng(), {
        filename,
        contentType: 'image/png',
      }).expect(201);

      const row = await testApp.prisma.storedFile.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.ownerId).toBe(userId);
      expect(row.storageKey).toMatch(STORAGE_KEY_SHAPE);
      expect(row.storageKey).not.toContain(marker);
      expect(row.originalName).toBe(res.body.originalName);
      expect(row.originalName).toContain(marker);
      expect(row.originalName).not.toMatch(/[/\\]/);
      expect(row.originalName.startsWith('.')).toBe(false);
      expect(existsSync(join(uploadDir(), row.storageKey))).toBe(true);
    },
  );

  it('decodes an RFC 5987 filename* parameter to a display name only', async () => {
    const res = await sendMultipart(
      testApp,
      auth,
      multipart([
        {
          name: 'file',
          dispositionExtra: `filename*=UTF-8''..%2F..%2F${marker}-k.png`,
          contentType: 'image/png',
          body: plainPng(),
        },
      ]),
    ).expect(201);
    expect(res.body.originalName).toBe(`${marker}-k.png`);
  });

  it('refuses a file name that is nothing but path parts', async () => {
    const before = (await storedFilesOf(testApp, userId)).length;
    for (const filename of ['../..', '..\\', '/']) {
      const res = await uploadFile(testApp, auth, plainPng(), {
        filename,
        contentType: 'image/png',
      });
      // The multipart parser drops an empty base name (no file → 400); were
      // it kept, the missing extension would be refused (415).
      expect([400, 415]).toContain(res.status);
    }
    expect(await storedFilesOf(testApp, userId)).toHaveLength(before);
  });

  it('never writes outside UPLOAD_LOCAL_DIR', async () => {
    // Every object below the upload directory has a generated key …
    const stored = listFilesRecursive();
    for (const path of stored) expect(path).toMatch(STORAGE_KEY_SHAPE);
    expect(stored.some((path) => path.includes(marker))).toBe(false);

    // … and nothing named after the client file names exists next to it,
    // above it, or at the absolute targets.
    const base = uploadDir();
    for (const dir of [base, dirname(base), dirname(dirname(base))]) {
      const names = readdirSync(dir);
      expect(names.filter((name) => name.includes(marker))).toEqual([]);
    }
    for (const absolute of [
      `/etc/${marker}-c.png`,
      `/tmp/${marker}-b.png`,
      `/${marker}-a.png`,
    ]) {
      expect(existsSync(absolute)).toBe(false);
    }
  });

  describe('traversal-looking ids in routes', () => {
    const ids = [
      '..%2F..%2Fetc%2Fpasswd',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '..%5C..%5Cwindows%5Cwin.ini',
      '%2e%2e',
      '..',
      '%2Fetc%2Fpasswd',
      `${randomUUID()}%2F..%2F..`,
      'files%2F2026%2F10%2Fx.png',
    ];

    it.each(ids)('GET/DELETE with id %j → 400 INVALID_ID', async (id) => {
      for (const suffix of ['', '/content', '/signed-url']) {
        const res = await testApp
          .http()
          .get(`${FILES_URL}/${id}${suffix}`)
          .set(auth.authHeader);
        // '..' as a whole segment is resolved by the router before matching.
        if (id === '..') {
          expect([400, 404]).toContain(res.status);
          continue;
        }
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_ID');
      }
      const del = await testApp
        .http()
        .delete(`${FILES_URL}/${id}`)
        .set(auth.authHeader);
      expect(id === '..' ? [400, 404] : [400]).toContain(del.status);
    });

    it('error bodies never echo the requested path', async () => {
      const res = await testApp
        .http()
        .get(`${FILES_URL}/..%2F..%2Fetc%2Fpasswd/content`)
        .set(auth.authHeader)
        .expect(400);
      expect(JSON.stringify(res.body)).not.toMatch(/passwd|etc/);
    });
  });

  it('rows of this user only ever reference generated keys', async () => {
    const rows = await storedFilesOf(testApp, userId);
    expect(rows.length).toBeGreaterThanOrEqual(traversalNames.length);
    for (const row of rows) expect(row.storageKey).toMatch(STORAGE_KEY_SHAPE);
  });
});
