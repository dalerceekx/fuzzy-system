import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { MALWARE_SCANNER } from '../../src/files/malware-scanner.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { STORAGE_DRIVER } from '../../src/storage/storage.types.js';
import {
  COMMENT_MARKER,
  GPS_MARKER,
  jpegWithMetadata,
  minimalPdf,
  plainPng,
  pngWithMetadata,
  readPngChunks,
  TEXT_MARKER,
  webpWithMetadata,
  XMP_MARKER,
} from '../fixtures/files/fixtures.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createAnimal, createFarm } from '../utils/factories.js';
import {
  createLoggedInUser,
  FILES_URL,
  multipart,
  readStoredObject,
  rejectionAuditsOf,
  sendMultipart,
  STORAGE_KEY_SHAPE,
  storedFilesOf,
  TestStorageDriver,
  uploadDir,
  uploadFile,
} from './support.js';

const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

function expectNoMetadataMarkers(buffer: Buffer) {
  const text = buffer.toString('latin1');
  for (const marker of [GPS_MARKER, TEXT_MARKER, XMP_MARKER, COMMENT_MARKER]) {
    expect(text).not.toContain(marker);
  }
}

describe('Files (default local storage)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['files'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('POST /files', () => {
    it('stores a JPEG under a generated key with EXIF/GPS removed', async () => {
      const { user, auth } = await createLoggedInUser(testApp);
      const input = jpegWithMetadata();

      const res = await uploadFile(testApp, auth, input, {
        filename: 'sigir rasmi.jpg',
        contentType: 'image/jpeg',
      }).expect(201);

      expect(Object.keys(res.body).sort()).toEqual(
        [
          'animalId',
          'createdAt',
          'id',
          'metadataStripped',
          'mimeType',
          'originalName',
          'scanStatus',
          'sha256',
          'sizeBytes',
        ].sort(),
      );
      expect(res.body).toMatchObject({
        originalName: 'sigir rasmi.jpg',
        mimeType: 'image/jpeg',
        scanStatus: 'SKIPPED',
        metadataStripped: true,
        animalId: null,
      });

      const row = await testApp.prisma.storedFile.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.ownerId).toBe(user.id);
      expect(row.storageKey).toMatch(STORAGE_KEY_SHAPE);
      expect(row.storageKey.endsWith('.jpg')).toBe(true);

      const stored = readStoredObject(row.storageKey);
      expectNoMetadataMarkers(stored);
      expect(stored.toString('latin1')).not.toContain('Exif');
      expect(stored.length).toBeLessThan(input.length);
      expect(await fileTypeFromBuffer(stored)).toMatchObject({ ext: 'jpg' });
      expect(res.body.sizeBytes).toBe(stored.length);
      expect(res.body.sha256).toBe(sha256(stored));

      const audit = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { action: 'file.uploaded', resourceId: row.id },
      });
      expect(audit).toMatchObject({ actorId: user.id, resourceType: 'file' });
      expect(audit.newValue).toMatchObject({
        sha256: row.sha256,
        mimeType: 'image/jpeg',
      });
    });

    it('removes PNG text chunks (CRCs stay valid) and WebP EXIF/XMP', async () => {
      const { auth } = await createLoggedInUser(testApp);

      const png = await uploadFile(testApp, auth, pngWithMetadata(), {
        filename: 'a.png',
        contentType: 'image/png',
      }).expect(201);
      const webp = await uploadFile(testApp, auth, webpWithMetadata(), {
        filename: 'b.webp',
        contentType: 'image/webp',
      }).expect(201);

      for (const id of [png.body.id, webp.body.id]) {
        const row = await testApp.prisma.storedFile.findUniqueOrThrow({
          where: { id },
        });
        const stored = readStoredObject(row.storageKey);
        expectNoMetadataMarkers(stored);
        expect(row.metadataStripped).toBe(true);
        if (row.mimeType === 'image/png') {
          const chunks = readPngChunks(stored);
          expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
          expect(chunks.every((c) => c.crcValid)).toBe(true);
        } else {
          expect(stored.readUInt32LE(4)).toBe(stored.length - 8);
        }
      }
    });

    it('stores a PDF unchanged', async () => {
      const { auth } = await createLoggedInUser(testApp);
      const pdf = minimalPdf();
      const res = await uploadFile(testApp, auth, pdf, {
        filename: 'tahlil.pdf',
        contentType: 'application/pdf',
      }).expect(201);
      expect(res.body).toMatchObject({
        mimeType: 'application/pdf',
        metadataStripped: false,
        sizeBytes: pdf.length,
        sha256: sha256(pdf),
      });
    });

    it('lets every authenticated role upload its own files', async () => {
      const { auth } = await createLoggedInUser(testApp, UserRole.VET);
      await uploadFile(testApp, auth, plainPng(), {
        filename: 'vet.png',
        contentType: 'image/png',
      }).expect(201);
    });

    it('requires authentication', async () => {
      const form = multipart([
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ]);
      const res = await testApp
        .http()
        .post(FILES_URL)
        .set('Content-Type', form.contentType)
        .send(form.body)
        .expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it.each([
      ['no multipart body', null, 'FILE_REQUIRED'],
      ['an empty file', Buffer.alloc(0), 'EMPTY_FILE'],
    ])('rejects %s with 400', async (_name, body, code) => {
      const { user, auth } = await createLoggedInUser(testApp);
      const req =
        body === null
          ? testApp.http().post(FILES_URL).set(auth.authHeader).send({})
          : uploadFile(testApp, auth, body, {
              filename: 'a.png',
              contentType: 'image/png',
            });
      const res = await req.expect(400);
      expect(res.body.code).toBe(code);
      expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
    });

    it('rejects the file under another field name and unknown text fields', async () => {
      const { user, auth } = await createLoggedInUser(testApp);
      await sendMultipart(
        testApp,
        auth,
        multipart([
          {
            name: 'upload',
            filename: 'a.png',
            contentType: 'image/png',
            body: plainPng(),
          },
        ]),
      ).expect(400);
      await uploadFile(testApp, auth, plainPng(), {
        filename: 'a.png',
        contentType: 'image/png',
        fields: { ownerId: randomUUID() },
      }).expect(400);
      await uploadFile(testApp, auth, plainPng(), {
        filename: 'a.png',
        contentType: 'image/png',
        fields: { animalId: 'not-a-uuid' },
      }).expect(400);
      expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
    });

    it('attaches a file to an own, non-archived animal only', async () => {
      const { user, auth } = await createLoggedInUser(testApp);
      const farm = await createFarm(testApp.prisma, { ownerId: user.id });
      const animal = await createAnimal(testApp.prisma, { farmId: farm.id });
      const archived = await createAnimal(testApp.prisma, { farmId: farm.id });
      await testApp.prisma.animal.update({
        where: { id: archived.id },
        data: { archivedAt: new Date(), archivedReason: 'test' },
      });
      const other = await createLoggedInUser(testApp);
      const otherFarm = await createFarm(testApp.prisma, {
        ownerId: other.user.id,
      });
      const foreign = await createAnimal(testApp.prisma, {
        farmId: otherFarm.id,
      });

      const ok = await uploadFile(testApp, auth, plainPng(), {
        filename: 'a.png',
        contentType: 'image/png',
        fields: { animalId: animal.id },
      }).expect(201);
      expect(ok.body.animalId).toBe(animal.id);

      for (const animalId of [foreign.id, archived.id, randomUUID()]) {
        const res = await uploadFile(testApp, auth, plainPng(), {
          filename: 'a.png',
          contentType: 'image/png',
          fields: { animalId },
        }).expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      const rows = await storedFilesOf(testApp, user.id);
      expect(rows.map((r) => r.id)).toEqual([ok.body.id]);
    });
  });

  describe('reading', () => {
    it('lists own files with pagination, sorting and an animal filter', async () => {
      const { user, auth } = await createLoggedInUser(testApp);
      const farm = await createFarm(testApp.prisma, { ownerId: user.id });
      const animal = await createAnimal(testApp.prisma, { farmId: farm.id });
      const small = await uploadFile(testApp, auth, plainPng(), {
        filename: 'small.png',
        contentType: 'image/png',
      }).expect(201);
      const large = await uploadFile(testApp, auth, minimalPdf(), {
        filename: 'large.pdf',
        contentType: 'application/pdf',
        fields: { animalId: animal.id },
      }).expect(201);
      // Someone else's file never shows up.
      const other = await createLoggedInUser(testApp);
      await uploadFile(testApp, other.auth, plainPng(), {
        filename: 'other.png',
        contentType: 'image/png',
      }).expect(201);

      const page = await testApp
        .http()
        .get(`${FILES_URL}?sort=-sizeBytes&limit=1`)
        .set(auth.authHeader)
        .expect(200);
      expect(page.body).toMatchObject({ page: 1, limit: 1, total: 2 });
      expect(page.body.items.map((f: { id: string }) => f.id)).toEqual([
        large.body.id,
      ]);
      expect(page.body.items[0]).not.toHaveProperty('storageKey');
      expect(page.body.items[0]).not.toHaveProperty('ownerId');

      const asc = await testApp
        .http()
        .get(`${FILES_URL}?sort=sizeBytes`)
        .set(auth.authHeader)
        .expect(200);
      expect(asc.body.items.map((f: { id: string }) => f.id)).toEqual([
        small.body.id,
        large.body.id,
      ]);

      const filtered = await testApp
        .http()
        .get(`${FILES_URL}?animalId=${animal.id}`)
        .set(auth.authHeader)
        .expect(200);
      expect(filtered.body.total).toBe(1);
      expect(filtered.body.items[0].id).toBe(large.body.id);
    });

    it.each([
      'limit=101',
      'sort=storageKey',
      'sort=ownerId',
      'page=0',
      'animalId=x',
    ])('rejects list query %s', async (query) => {
      const { auth } = await createLoggedInUser(testApp);
      await testApp
        .http()
        .get(`${FILES_URL}?${query}`)
        .set(auth.authHeader)
        .expect(400);
    });

    it('returns metadata and streams content with download-only headers', async () => {
      const { auth } = await createLoggedInUser(testApp);
      const up = await uploadFile(testApp, auth, plainPng(), {
        // Browsers send a quote as %22 inside the filename parameter.
        filename: 'ona sigir %221%22.png',
        contentType: 'image/png',
      }).expect(201);

      const meta = await testApp
        .http()
        .get(`${FILES_URL}/${up.body.id}`)
        .set(auth.authHeader)
        .expect(200);
      expect(meta.body).toEqual(up.body);

      const content = await testApp
        .http()
        .get(`${FILES_URL}/${up.body.id}/content`)
        .set(auth.authHeader)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((content.body as Buffer).equals(plainPng())).toBe(true);
      expect(content.headers).toMatchObject({
        'content-type': 'image/png',
        'content-length': String(plainPng().length),
        'content-disposition':
          "attachment; filename*=UTF-8''ona%20sigir%20%221%22.png",
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      });
    });

    it('has no signed URL with the local driver (404)', async () => {
      const { auth } = await createLoggedInUser(testApp);
      const up = await uploadFile(testApp, auth, plainPng(), {
        filename: 'a.png',
        contentType: 'image/png',
      }).expect(201);
      await testApp
        .http()
        .get(`${FILES_URL}/${up.body.id}/signed-url`)
        .set(auth.authHeader)
        .expect(404);
    });
  });

  describe('DELETE /files/:id', () => {
    it('soft-deletes the row, removes the object and audits', async () => {
      const { user, auth } = await createLoggedInUser(testApp);
      const up = await uploadFile(testApp, auth, plainPng(), {
        filename: 'a.png',
        contentType: 'image/png',
      }).expect(201);
      const { storageKey } = await testApp.prisma.storedFile.findUniqueOrThrow({
        where: { id: up.body.id },
      });
      expect(existsSync(join(uploadDir(), storageKey))).toBe(true);

      await testApp
        .http()
        .delete(`${FILES_URL}/${up.body.id}`)
        .set(auth.authHeader)
        .expect(204);

      const row = await testApp.prisma.storedFile.findUniqueOrThrow({
        where: { id: up.body.id },
      });
      expect(row.deletedAt).not.toBeNull();
      expect(existsSync(join(uploadDir(), storageKey))).toBe(false);
      const audit = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { action: 'file.deleted', resourceId: up.body.id },
      });
      expect(audit.actorId).toBe(user.id);

      for (const path of ['', '/content', '/signed-url']) {
        await testApp
          .http()
          .get(`${FILES_URL}/${up.body.id}${path}`)
          .set(auth.authHeader)
          .expect(404);
      }
      await testApp
        .http()
        .delete(`${FILES_URL}/${up.body.id}`)
        .set(auth.authHeader)
        .expect(404);
      const list = await testApp
        .http()
        .get(FILES_URL)
        .set(auth.authHeader)
        .expect(200);
      expect(list.body.total).toBe(0);
    });
  });
});

describe('Files quota', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['files'],
      env: { UPLOAD_MAX_FILES_PER_USER: '2', UPLOAD_USER_QUOTA_BYTES: '600' },
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const png = { filename: 'a.png', contentType: 'image/png' };

  it('refuses the file over the count limit with 409 and frees quota on delete', async () => {
    const { user, auth } = await createLoggedInUser(testApp);
    const first = await uploadFile(testApp, auth, plainPng(), png).expect(201);
    await uploadFile(testApp, auth, plainPng(), png).expect(201);
    const before = await storedFilesOf(testApp, user.id);

    const res = await uploadFile(testApp, auth, plainPng(), png).expect(409);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(await storedFilesOf(testApp, user.id)).toHaveLength(before.length);

    await testApp
      .http()
      .delete(`${FILES_URL}/${first.body.id}`)
      .set(auth.authHeader)
      .expect(204);
    await uploadFile(testApp, auth, plainPng(), png).expect(201);
  });

  it('refuses the file over the byte quota with 409', async () => {
    const { user, auth } = await createLoggedInUser(testApp);
    const padded = Buffer.concat([minimalPdf(), Buffer.alloc(400, 0x20)]);
    await uploadFile(testApp, auth, padded, {
      filename: 'a.pdf',
      contentType: 'application/pdf',
    }).expect(201);
    const res = await uploadFile(testApp, auth, padded, {
      filename: 'b.pdf',
      contentType: 'application/pdf',
    }).expect(409);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(await storedFilesOf(testApp, user.id)).toHaveLength(1);
  });

  it('holds under concurrent uploads (advisory lock)', async () => {
    const { user, auth } = await createLoggedInUser(testApp);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        uploadFile(testApp, auth, plainPng(), png),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 409, 409, 409]);
    expect(await storedFilesOf(testApp, user.id)).toHaveLength(2);
  });
});

describe('Files with a signing driver, malware scanner and storage outage', () => {
  let testApp: TestApp;
  const storage = new TestStorageDriver();
  let verdict: 'clean' | 'infected' | 'unscanned' = 'clean';

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['files'],
      env: { S3_SIGNED_URL_TTL_SECONDS: '120' },
      configure: (builder) =>
        builder
          .overrideProvider(STORAGE_DRIVER)
          .useValue(storage)
          .overrideProvider(MALWARE_SCANNER)
          .useValue({ scan: () => Promise.resolve(verdict) }),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    verdict = 'clean';
    storage.failPuts = false;
  });

  it('marks scanned files CLEAN and returns a short-lived signed URL', async () => {
    const { auth } = await createLoggedInUser(testApp);
    const up = await uploadFile(testApp, auth, plainPng(), {
      filename: '../rasm.png',
      contentType: 'image/png',
    }).expect(201);
    expect(up.body.scanStatus).toBe('CLEAN');

    const before = Date.now();
    const res = await testApp
      .http()
      .get(`${FILES_URL}/${up.body.id}/signed-url`)
      .set(auth.authHeader)
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'url']);
    const row = await testApp.prisma.storedFile.findUniqueOrThrow({
      where: { id: up.body.id },
    });
    expect(storage.signed.at(-1)).toEqual({
      key: row.storageKey,
      opts: {
        expiresInSeconds: 120,
        downloadName: 'rasm.png',
        contentType: 'image/png',
      },
    });
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 119_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 121_000);
  });

  it('rejects an infected file with 422 and stores nothing', async () => {
    verdict = 'infected';
    const { user, auth } = await createLoggedInUser(testApp);
    const res = await uploadFile(testApp, auth, plainPng(), {
      filename: 'a.png',
      contentType: 'image/png',
    }).expect(422);
    expect(res.body.code).toBe('FILE_INFECTED');
    expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
    const audits = await rejectionAuditsOf(testApp, user.id);
    expect(
      audits.map((a) => (a.newValue as { reason: string }).reason),
    ).toEqual(['infected']);
  });

  it('does not serve files whose scan has not passed', async () => {
    const { auth } = await createLoggedInUser(testApp);
    const up = await uploadFile(testApp, auth, plainPng(), {
      filename: 'a.png',
      contentType: 'image/png',
    }).expect(201);
    await testApp.prisma.storedFile.update({
      where: { id: up.body.id },
      data: { scanStatus: 'PENDING' },
    });
    for (const path of ['/content', '/signed-url']) {
      const res = await testApp
        .http()
        .get(`${FILES_URL}/${up.body.id}${path}`)
        .set(auth.authHeader)
        .expect(409);
      expect(res.body.code).toBe('FILE_NOT_AVAILABLE');
    }
  });

  it('returns 503 and soft-deletes the row when storage is down', async () => {
    storage.failPuts = true;
    const { user, auth } = await createLoggedInUser(testApp);
    const res = await uploadFile(testApp, auth, plainPng(), {
      filename: 'a.png',
      contentType: 'image/png',
    }).expect(503);
    expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
    const rows = await storedFilesOf(testApp, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
    const audits = await rejectionAuditsOf(testApp, user.id);
    expect(audits[0]).toMatchObject({ resourceId: rows[0].id });
    // The soft-deleted row does not count against the quota or the list.
    const list = await testApp
      .http()
      .get(FILES_URL)
      .set(auth.authHeader)
      .expect(200);
    expect(list.body.total).toBe(0);
  });
});
