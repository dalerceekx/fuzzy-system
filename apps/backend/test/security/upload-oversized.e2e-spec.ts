import { minimalPdf, plainPng } from '../fixtures/files/fixtures.js';
import {
  createLoggedInUser,
  listFilesRecursive,
  multipart,
  sendMultipart,
  storedFilesOf,
  uploadFile,
} from '../files/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';

const MAX_BYTES = 4096;

/** A valid PDF of exactly `size` bytes. */
function pdfOfSize(size: number): Buffer {
  const pdf = minimalPdf();
  return Buffer.concat([pdf, Buffer.alloc(size - pdf.length, 0x20)]);
}

describe('Security: oversized and multi-file uploads', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['files'],
      env: { UPLOAD_MAX_FILE_BYTES: String(MAX_BYTES) },
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const pdf = { filename: 'hujjat.pdf', contentType: 'application/pdf' };

  it('accepts a file of exactly UPLOAD_MAX_FILE_BYTES', async () => {
    const { auth } = await createLoggedInUser(testApp);
    const res = await uploadFile(
      testApp,
      auth,
      pdfOfSize(MAX_BYTES),
      pdf,
    ).expect(201);
    expect(res.body.sizeBytes).toBe(MAX_BYTES);
  });

  it.each([MAX_BYTES + 1, 1024 * 1024])(
    'rejects a %d-byte file with 413 and stores nothing',
    async (size) => {
      const { user, auth } = await createLoggedInUser(testApp);
      const objectsBefore = listFilesRecursive();

      const res = await uploadFile(testApp, auth, pdfOfSize(size), pdf).expect(
        413,
      );

      expect(res.body).toMatchObject({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/File too large|multer/i);
      expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
      expect(listFilesRecursive()).toEqual(objectsBefore);
    },
  );

  it.each([
    [
      'two files in the file field',
      [
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
        {
          name: 'file',
          filename: 'b.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ],
    ],
    [
      'a second file under another field',
      [
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
        {
          name: 'extra',
          filename: 'b.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ],
    ],
    [
      'too many text fields',
      [
        ...Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, body: 'x' })),
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ],
    ],
    [
      'an oversized text field',
      [
        { name: 'animalId', body: 'x'.repeat(2048) },
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ],
    ],
    [
      'an oversized field name',
      [
        { name: 'n'.repeat(200), body: 'x' },
        {
          name: 'file',
          filename: 'a.png',
          contentType: 'image/png',
          body: plainPng(),
        },
      ],
    ],
  ])('rejects %s with 400 and stores nothing', async (_name, parts) => {
    const { user, auth } = await createLoggedInUser(testApp);
    const objectsBefore = listFilesRecursive();

    const res = await sendMultipart(testApp, auth, multipart(parts)).expect(
      400,
    );

    expect(res.body.statusCode).toBe(400);
    expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
    expect(listFilesRecursive()).toEqual(objectsBefore);
  });
});
