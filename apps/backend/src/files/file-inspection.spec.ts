import {
  elfExecutable,
  htmlPage,
  jpegWithMetadata,
  minimalPdf,
  plainPng,
  pngHtmlPolyglot,
  shellScript,
  svgImage,
  utf16Html,
  webpWithMetadata,
  windowsExecutable,
} from '../../test/fixtures/files/fixtures.js';
import {
  hasActiveContent,
  inspectUpload,
  nameExtension,
  normalizeMime,
} from './file-inspection.js';

describe('inspectUpload', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', jpegWithMetadata(), 'jpg'],
    ['PHOTO.JPEG', 'image/jpeg', jpegWithMetadata(), 'jpg'],
    ['rasm.png', 'image/png', plainPng(), 'png'],
    ['a.webp', 'image/webp', webpWithMetadata(), 'webp'],
    ['hujjat.pdf', 'application/pdf; charset=binary', minimalPdf(), 'pdf'],
  ])('accepts %s (%s)', async (originalName, declaredMime, buffer, ext) => {
    const result = await inspectUpload({ buffer, originalName, declaredMime });
    expect(result).toMatchObject({ ok: true, type: { ext } });
  });

  it.each([
    ['svg as image/png', 'x.png', 'image/png', svgImage(), 'active_content'],
    ['svg as svg', 'x.svg', 'image/svg+xml', svgImage(), 'active_content'],
    ['html as png', 'x.png', 'image/png', htmlPage(), 'active_content'],
    ['utf-16 html', 'x.png', 'image/png', utf16Html(), 'active_content'],
    ['PE renamed', 'x.png', 'image/png', windowsExecutable(), 'active_content'],
    [
      'ELF renamed',
      'x.pdf',
      'application/pdf',
      elfExecutable(),
      'active_content',
    ],
    ['script renamed', 'x.jpg', 'image/jpeg', shellScript(), 'active_content'],
    [
      'png+html polyglot',
      'x.png',
      'image/png',
      pngHtmlPolyglot(),
      'active_content',
    ],
    ['png named .jpg', 'x.jpg', 'image/jpeg', plainPng(), 'type_mismatch'],
    ['png declared jpeg', 'x.png', 'image/jpeg', plainPng(), 'type_mismatch'],
    [
      'jpeg named .png',
      'x.png',
      'image/png',
      jpegWithMetadata(),
      'type_mismatch',
    ],
    ['no extension', 'photo', 'image/png', plainPng(), 'extension_not_allowed'],
    [
      'double extension',
      'x.png.exe',
      'image/png',
      plainPng(),
      'extension_not_allowed',
    ],
    [
      'gif extension',
      'x.gif',
      'image/png',
      plainPng(),
      'extension_not_allowed',
    ],
    [
      'octet-stream',
      'x.png',
      'application/octet-stream',
      plainPng(),
      'mime_not_allowed',
    ],
    ['missing mime', 'x.png', undefined, plainPng(), 'mime_not_allowed'],
    [
      'random bytes',
      'x.png',
      'image/png',
      Buffer.from('just some text'),
      'content_not_allowed',
    ],
  ])(
    'rejects %s',
    async (_name, originalName, declaredMime, buffer, reason) => {
      const result = await inspectUpload({
        buffer,
        originalName,
        declaredMime,
      });
      expect(result).toMatchObject({ ok: false, reason });
    },
  );
});

describe('hasActiveContent', () => {
  it('looks past a BOM and leading whitespace', () => {
    expect(hasActiveContent(Buffer.from('\ufeff  \n<SVG xmlns="x"/>'))).toBe(
      true,
    );
    expect(hasActiveContent(Buffer.from('\r\n MZ\x90\x00'))).toBe(true);
  });

  it('only inspects the first KiB', () => {
    const late = Buffer.concat([
      Buffer.alloc(2048, 0x41),
      Buffer.from('<html>'),
    ]);
    expect(hasActiveContent(late)).toBe(false);
  });

  it('does not flag plain images', () => {
    expect(hasActiveContent(plainPng())).toBe(false);
    expect(hasActiveContent(jpegWithMetadata())).toBe(false);
    expect(hasActiveContent(minimalPdf())).toBe(false);
  });
});

describe('helpers', () => {
  it.each([
    ['a.JPG', 'jpg'],
    ['a.tar.gz', 'gz'],
    ['../../etc/passwd.png', 'png'],
    ['..\\..\\win.ini.png', 'png'],
    ['.png', ''],
    ['noext', ''],
    ['dir.png/file', ''],
  ])('nameExtension(%j) = %j', (name, ext) => {
    expect(nameExtension(name)).toBe(ext);
  });

  it('normalizeMime lower-cases and drops parameters', () => {
    expect(normalizeMime(' Image/PNG ; foo=bar')).toBe('image/png');
    expect(normalizeMime(undefined)).toBe('');
  });
});
