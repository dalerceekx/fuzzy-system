import {
  generateNumericCode,
  hashIdentifier,
  hmacSha256Hex,
  keyId,
  randomToken,
  safeEqual,
  sha256Hex,
} from './crypto.js';

describe('crypto helpers', () => {
  it('sha256Hex / hmacSha256Hex match known vectors', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
    ).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('safeEqual compares exactly, including different lengths and non-strings', () => {
    expect(safeEqual('token-123', 'token-123')).toBe(true);
    expect(safeEqual('token-123', 'token-124')).toBe(false);
    expect(safeEqual('short', 'short-but-longer')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual(undefined as unknown as string, 'x')).toBe(false);
  });

  it('randomToken is base64url with the requested entropy', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(Array.from({ length: 50 }, () => randomToken())).size).toBe(
      50,
    );
  });

  it('generateNumericCode is zero-padded and uniformly numeric', () => {
    const codes = Array.from({ length: 500 }, () => generateNumericCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(generateNumericCode(8)).toMatch(/^\d{8}$/);
    expect(() => generateNumericCode(0)).toThrow(RangeError);
    expect(() => generateNumericCode(13)).toThrow(RangeError);
  });

  it('hashIdentifier is a stable 32-hex pseudonym that hides the input', () => {
    const id = hashIdentifier('+998901234567');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIdentifier('+998901234567')).toBe(id);
    expect(id).not.toContain('998901234567');
  });

  it('keyId is the first 8 hex chars of sha256(secret)', () => {
    expect(keyId('abc')).toBe('ba7816bf');
  });
});
