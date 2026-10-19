import {
  elfExecutable,
  htmlPage,
  jpegWithMarkupBehindMetadata,
  jpegWithMetadata,
  plainPng,
  pngHtmlPolyglot,
  pngWithMarkupBehindMetadata,
  shellScript,
  svgImage,
  utf16Html,
  webpWithMarkupBehindMetadata,
  windowsExecutable,
} from '../fixtures/files/fixtures.js';
import {
  createLoggedInUser,
  listFilesRecursive,
  rejectionAuditsOf,
  storedFilesOf,
  uploadFile,
} from '../files/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';

// The type is decided by four independent checks (extension, declared MIME,
// magic bytes, agreement) plus an active-content sniff; any failure → 415,
// nothing stored, audited as file.rejected.

describe('Security: upload MIME / magic-byte validation', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['files'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const cases: Array<{
    name: string;
    body: () => Buffer;
    filename: string;
    contentType: string;
    reason: string;
  }> = [
    {
      name: 'HTML declared as image/png',
      body: htmlPage,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    {
      name: 'UTF-16 HTML declared as image/png',
      body: utf16Html,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    {
      name: 'PNG bytes named .jpg (declared image/jpeg)',
      body: plainPng,
      filename: 'rasm.jpg',
      contentType: 'image/jpeg',
      reason: 'type_mismatch',
    },
    {
      name: 'PNG bytes named .png but declared image/jpeg',
      body: plainPng,
      filename: 'rasm.png',
      contentType: 'image/jpeg',
      reason: 'type_mismatch',
    },
    {
      name: 'JPEG bytes named .png',
      body: jpegWithMetadata,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'type_mismatch',
    },
    {
      name: 'SVG as image/svg+xml',
      body: svgImage,
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      reason: 'active_content',
    },
    {
      name: 'SVG renamed to .png',
      body: svgImage,
      filename: 'logo.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    {
      name: 'Windows executable renamed to .png',
      body: windowsExecutable,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    {
      name: 'ELF executable renamed to .pdf',
      body: elfExecutable,
      filename: 'hujjat.pdf',
      contentType: 'application/pdf',
      reason: 'active_content',
    },
    {
      name: 'shell script renamed to .jpg',
      body: shellScript,
      filename: 'rasm.jpg',
      contentType: 'image/jpeg',
      reason: 'active_content',
    },
    {
      name: 'PNG/HTML polyglot',
      body: pngHtmlPolyglot,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    // The markup sits beyond the sniffed head of the upload; stripping the
    // padding metadata pulls it into the head of the stored object.
    {
      name: 'JPEG whose markup surfaces after metadata stripping',
      body: jpegWithMarkupBehindMetadata,
      filename: 'rasm.jpg',
      contentType: 'image/jpeg',
      reason: 'active_content',
    },
    {
      name: 'PNG whose markup surfaces after metadata stripping',
      body: pngWithMarkupBehindMetadata,
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'active_content',
    },
    {
      name: 'WebP whose markup surfaces after metadata stripping',
      body: webpWithMarkupBehindMetadata,
      filename: 'rasm.webp',
      contentType: 'image/webp',
      reason: 'active_content',
    },
    {
      name: 'plain text named .png',
      body: () => Buffer.from('hello, not an image'),
      filename: 'rasm.png',
      contentType: 'image/png',
      reason: 'content_not_allowed',
    },
    {
      name: 'disallowed extension (.gif)',
      body: plainPng,
      filename: 'rasm.gif',
      contentType: 'image/png',
      reason: 'extension_not_allowed',
    },
    {
      name: 'double extension ending in .exe',
      body: plainPng,
      filename: 'rasm.png.exe',
      contentType: 'image/png',
      reason: 'extension_not_allowed',
    },
    {
      name: 'disallowed declared MIME',
      body: plainPng,
      filename: 'rasm.png',
      contentType: 'application/octet-stream',
      reason: 'mime_not_allowed',
    },
    {
      name: 'JPEG magic bytes with a broken structure',
      body: () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00, 0x01]),
      filename: 'rasm.jpg',
      contentType: 'image/jpeg',
      reason: 'malformed_image',
    },
  ];

  it.each(cases)(
    'rejects $name with 415, stores nothing and audits',
    async ({ body, filename, contentType, reason }) => {
      const { user, auth } = await createLoggedInUser(testApp);
      const objectsBefore = listFilesRecursive();

      const res = await uploadFile(testApp, auth, body(), {
        filename,
        contentType,
      }).expect(415);

      expect(res.body).toMatchObject({
        statusCode: 415,
        code: 'UNSUPPORTED_FILE_TYPE',
      });
      expect(await storedFilesOf(testApp, user.id)).toHaveLength(0);
      expect(listFilesRecursive()).toEqual(objectsBefore);

      const audits = await rejectionAuditsOf(testApp, user.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        resourceType: 'file',
        resourceId: null,
        actorRole: 'FARMER',
      });
      expect(audits[0].newValue).toMatchObject({
        reason,
        declaredMime: contentType,
        sizeBytes: body().length,
      });
    },
  );

  it('accepts the same bytes when name, MIME and content agree', async () => {
    const { auth } = await createLoggedInUser(testApp);
    await uploadFile(testApp, auth, plainPng(), {
      filename: 'rasm.png',
      contentType: 'image/png',
    }).expect(201);
  });
});
