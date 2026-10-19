import { randomBytes, scryptSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  hashPassword,
  needsRehash,
  verificationPadding,
  verifyPassword,
} from './password.js';
import { PasswordService } from './password.service.js';

const COST = 1024;

describe('password hashing (scrypt)', () => {
  it('stores N, r, p, salt and hash in the result', async () => {
    const stored = await hashPassword('Correct-horse-1', COST);
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(stored).not.toContain('Correct-horse-1');
  });

  it('uses a fresh salt every time', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same', COST),
      hashPassword('same', COST),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password only', async () => {
    const stored = await hashPassword('Correct-horse-1', COST);
    await expect(verifyPassword('Correct-horse-1', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct-horse-1', stored)).resolves.toBe(
      false,
    );
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('accepts the legacy `scrypt$<salt>$<hash>` format (N=16384, r=8, p=1)', async () => {
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString('hex')}$${scryptSync('Legacy-pass-1', salt, 64).toString('hex')}`;
    await expect(verifyPassword('Legacy-pass-1', legacy)).resolves.toBe(true);
    await expect(verifyPassword('wrong', legacy)).resolves.toBe(false);
    expect(needsRehash(legacy, COST)).toBe(true);
  });

  it.each([
    '',
    'plaintext',
    'bcrypt$2b$10$abc',
    'scrypt$1024$8$1$zz$aa',
    'scrypt$1000$8$1$00112233445566778899aabbccddeeff$' + 'ab'.repeat(64),
    'scrypt$2097152$8$1$00112233445566778899aabbccddeeff$' + 'ab'.repeat(64),
    'scrypt$1024$64$1$00112233445566778899aabbccddeeff$' + 'ab'.repeat(64),
    'scrypt$1024$8$1$00112233445566778899aabbccddeeff$abcd',
  ])('rejects malformed or out-of-range stored value %#', async (stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    expect(needsRehash(stored, COST)).toBe(true);
  });

  it('needsRehash detects a changed cost', async () => {
    const stored = await hashPassword('pw-123456', COST);
    expect(needsRehash(stored, COST)).toBe(false);
    expect(needsRehash(stored, 2048)).toBe(true);
  });

  it('refuses invalid cost parameters when hashing', async () => {
    await expect(hashPassword('x', 1000)).rejects.toThrow(RangeError);
    await expect(hashPassword('x', 512)).rejects.toThrow(RangeError);
  });

  it('handles the production cost (needs maxmem above the 32 MiB default)', async () => {
    const stored = await hashPassword('Strong-pass-9', 65_536);
    await expect(verifyPassword('Strong-pass-9', stored)).resolves.toBe(true);
  });
});

describe('verificationPadding (timing parity for failed checks)', () => {
  const salt = '00112233445566778899aabbccddeeff';
  const hash = 'ab'.repeat(64);
  const sum = (runs: number[]) => runs.reduce((a, b) => a + b, 0);

  it('fills a legacy (N=16384) hash up to the current cost', () => {
    const runs = verificationPadding(`scrypt$${salt}$${hash}`, 65_536);
    expect(runs).toStrictEqual([32_768, 16_384]);
    expect(16_384 + sum(runs)).toBe(65_536);
  });

  it('fills a lower-cost modern hash and pads unparsable values fully', () => {
    expect(
      verificationPadding(`scrypt$32768$8$1$${salt}$${hash}`, 65_536),
    ).toStrictEqual([32_768]);
    expect(verificationPadding('not-a-hash', 65_536)).toStrictEqual([65_536]);
    expect(verificationPadding('', 32_768)).toStrictEqual([32_768]);
  });

  it('adds nothing when the stored hash already costs as much or more', () => {
    expect(
      verificationPadding(`scrypt$65536$8$1$${salt}$${hash}`, 65_536),
    ).toStrictEqual([]);
    expect(
      verificationPadding(`scrypt$131072$8$1$${salt}$${hash}`, 65_536),
    ).toStrictEqual([]);
  });
});

describe('PasswordService', () => {
  const service = new PasswordService(
    new ConfigService({ PASSWORD_SCRYPT_COST: COST }) as ConstructorParameters<
      typeof PasswordService
    >[0],
  );

  it('hashes with the configured cost and verifies', async () => {
    const stored = await service.hash('Service-pass-1');
    expect(stored.startsWith('scrypt$1024$')).toBe(true);
    await expect(service.verify('Service-pass-1', stored)).resolves.toBe(true);
    expect(service.needsRehash(stored)).toBe(false);
  });

  it('verifies legacy hashes correctly when padding a failure', async () => {
    const strong = new PasswordService(
      new ConfigService({
        PASSWORD_SCRYPT_COST: 32_768,
      }) as ConstructorParameters<typeof PasswordService>[0],
    );
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString('hex')}$${scryptSync('Legacy-pass-1', salt, 64).toString('hex')}`;
    await expect(strong.verify('Legacy-pass-1', legacy)).resolves.toBe(true);
    await expect(strong.verify('wrong', legacy)).resolves.toBe(false);
    await expect(strong.verify('wrong', 'garbage')).resolves.toBe(false);
  });

  it('verifyDummy always resolves to false after doing real work', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBe(false);
    await expect(service.verifyDummy('')).resolves.toBe(false);
  });
});
