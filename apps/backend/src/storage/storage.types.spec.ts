import {
  assertSafeStorageKey,
  attachmentContentDisposition,
  buildStorageKey,
  STORAGE_KEY_PATTERN,
  UnsafeStorageKeyError,
} from './storage.types.js';

describe('storage keys', () => {
  it('builds server-side keys files/<yyyy>/<mm>/<uuid-v4>.<ext>', () => {
    const key = buildStorageKey('jpg', new Date('2026-03-05T23:30:00Z'));
    expect(key).toMatch(
      /^files\/2026\/03\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
    );
    expect(STORAGE_KEY_PATTERN.test(key)).toBe(true);
    expect(buildStorageKey('pdf')).not.toBe(buildStorageKey('pdf'));
  });

  it('only builds keys for allowlisted extensions', () => {
    expect(() => buildStorageKey('svg' as never)).toThrow(
      UnsafeStorageKeyError,
    );
    expect(() => buildStorageKey('html' as never)).toThrow(
      UnsafeStorageKeyError,
    );
  });

  it.each([
    'files/2026/10/abc.jpg',
    'files/2026/10/0b9a3c3e-8d6a-4a62-b3a5-6a8f1f0c2e11.webp',
    'a.pdf',
  ])('accepts %s', (key) => {
    expect(() => assertSafeStorageKey(key)).not.toThrow();
  });

  it.each([
    '../etc/passwd.jpg',
    'files/../../etc/passwd.jpg',
    'files/..%2f..%2fetc/passwd.jpg',
    '/etc/passwd.jpg',
    '/files/2026/10/a.jpg',
    'C:\\windows\\system32.png',
    'files\\2026\\a.jpg',
    'files/2026/10/a.svg',
    'files/2026/10/a.html',
    'files/2026/10/a.jpg.exe',
    'files/2026/10/A.JPG',
    'files//a.jpg',
    'files/./a.jpg',
    'files/a.jpg\u0000.png',
    'files/a b.jpg',
    '',
    `files/${'a'.repeat(260)}.jpg`,
  ])('rejects unsafe key %j', (key) => {
    expect(() => assertSafeStorageKey(key)).toThrow(UnsafeStorageKeyError);
  });

  it('rejects non-strings', () => {
    expect(() => assertSafeStorageKey(undefined as unknown as string)).toThrow(
      UnsafeStorageKeyError,
    );
  });

  it('encodes download names for Content-Disposition (RFC 5987)', () => {
    expect(attachmentContentDisposition("o'g'il (1).pdf")).toBe(
      "attachment; filename*=UTF-8''o%27g%27il%20%281%29.pdf",
    );
    expect(attachmentContentDisposition('sigir rasmi.jpg')).toBe(
      "attachment; filename*=UTF-8''sigir%20rasmi.jpg",
    );
    expect(attachmentContentDisposition('a"\r\nb.pdf')).not.toMatch(/["\r\n]/);
  });
});
