import { base32Decode, base32Encode } from './base32.js';
import { hotp, matchTotp, otpauthUrl, totpStep } from './totp.js';

const ascii = (value: string) => Buffer.from(value, 'ascii');

describe('base32 (RFC 4648 test vectors)', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  it.each(vectors)('encodes %j as %s (unpadded)', (input, encoded) => {
    expect(base32Encode(ascii(input))).toBe(encoded);
  });

  it.each(vectors)(
    'decodes %j (padded, unpadded, lower case)',
    (input, encoded) => {
      const padded = encoded.padEnd(Math.ceil(encoded.length / 8) * 8, '=');
      expect(base32Decode(encoded).toString('ascii')).toBe(input);
      expect(base32Decode(padded).toString('ascii')).toBe(input);
      expect(base32Decode(encoded.toLowerCase()).toString('ascii')).toBe(input);
    },
  );

  it('round-trips random 20-byte secrets', () => {
    for (let i = 0; i < 50; i++) {
      const secret = Buffer.from(
        Array.from({ length: 20 }, () => Math.floor(Math.random() * 256)),
      );
      expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    }
  });

  it('rejects characters outside the alphabet', () => {
    for (const bad of ['MZX1', 'MZX8', 'MZ XW', 'MZ=XW']) {
      expect(() => base32Decode(bad)).toThrow();
    }
  });
});

describe('HOTP (RFC 4226 appendix D)', () => {
  const secret = ascii('12345678901234567890');
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];

  it.each(expected.map((code, counter) => [counter, code]))(
    'counter %i → %s',
    (counter, code) => {
      expect(hotp(secret, counter as number)).toBe(code);
    },
  );
});

describe('TOTP (RFC 6238 appendix B, 8 digits)', () => {
  const secrets = {
    sha1: ascii('12345678901234567890'),
    sha256: ascii('12345678901234567890123456789012'),
    sha512: ascii(
      '1234567890123456789012345678901234567890123456789012345678901234',
    ),
  } as const;
  const vectors: Array<[number, keyof typeof secrets, string]> = [
    [59, 'sha1', '94287082'],
    [59, 'sha256', '46119246'],
    [59, 'sha512', '90693936'],
    [1111111109, 'sha1', '07081804'],
    [1111111109, 'sha256', '68084774'],
    [1111111109, 'sha512', '25091201'],
    [1111111111, 'sha1', '14050471'],
    [1111111111, 'sha256', '67062674'],
    [1111111111, 'sha512', '99943326'],
    [1234567890, 'sha1', '89005924'],
    [1234567890, 'sha256', '91819424'],
    [1234567890, 'sha512', '93441116'],
    [2000000000, 'sha1', '69279037'],
    [2000000000, 'sha256', '90698825'],
    [2000000000, 'sha512', '38618901'],
    [20000000000, 'sha1', '65353130'],
    [20000000000, 'sha256', '77737706'],
    [20000000000, 'sha512', '47863826'],
  ];

  it.each(vectors)('T=%i %s → %s', (time, algorithm, code) => {
    const step = totpStep(time * 1000);
    expect(hotp(secrets[algorithm], step, 8, algorithm)).toBe(code);
  });
});

describe('matchTotp', () => {
  const secret = ascii('12345678901234567890');
  const nowMs = 1_111_111_111_000;
  const step = totpStep(nowMs);
  const codeAt = (s: number) => hotp(secret, s);

  it('accepts the current step and ±1 step of drift, returning the step', () => {
    expect(matchTotp(secret, codeAt(step), { nowMs })).toBe(step);
    expect(matchTotp(secret, codeAt(step - 1), { nowMs })).toBe(step - 1);
    expect(matchTotp(secret, codeAt(step + 1), { nowMs })).toBe(step + 1);
  });

  it('rejects codes outside the window', () => {
    expect(matchTotp(secret, codeAt(step - 2), { nowMs })).toBeNull();
    expect(matchTotp(secret, codeAt(step + 2), { nowMs })).toBeNull();
  });

  it('never accepts a step at or before afterStep (replay)', () => {
    expect(
      matchTotp(secret, codeAt(step), { nowMs, afterStep: step }),
    ).toBeNull();
    expect(
      matchTotp(secret, codeAt(step - 1), { nowMs, afterStep: step - 1 }),
    ).toBeNull();
    expect(
      matchTotp(secret, codeAt(step + 1), { nowMs, afterStep: step }),
    ).toBe(step + 1);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 12345', '12345\n']) {
      expect(matchTotp(secret, bad, { nowMs })).toBeNull();
    }
  });
});

describe('otpauthUrl', () => {
  it('builds a Key Uri Format URL with an encoded label', () => {
    const url = otpauthUrl({
      issuer: 'Mening Fermam',
      account: '+99890*****67',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    });
    expect(url).toBe(
      'otpauth://totp/Mening%20Fermam:%2B99890*****67?secret=JBSWY3DPEHPK3PXP&issuer=Mening+Fermam&algorithm=SHA1&digits=6&period=30',
    );
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
  });
});
