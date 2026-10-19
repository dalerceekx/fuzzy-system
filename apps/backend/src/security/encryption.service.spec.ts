import { ConfigService } from '@nestjs/config';
import { keyId } from './crypto.js';
import {
  buildKeyRing,
  DecryptionError,
  decryptWithRing,
  EncryptionService,
  encryptWithKey,
  mfaSecretAad,
} from './encryption.service.js';

const CURRENT = Buffer.alloc(32, 7).toString('base64');
const PREVIOUS = Buffer.alloc(32, 9).toString('base64');

function service(current: string, previous: string[] = []): EncryptionService {
  return new EncryptionService(
    new ConfigService({
      DATA_ENCRYPTION_KEY: current,
      DATA_ENCRYPTION_KEYS_PREVIOUS: previous,
    }) as ConstructorParameters<typeof EncryptionService>[0],
  );
}

describe('EncryptionService (AES-256-GCM)', () => {
  const encryption = service(CURRENT, [PREVIOUS]);

  it('round-trips and uses the documented payload format', () => {
    const payload = encryption.encrypt('JBSWY3DPEHPK3PXP');
    const [version, kid, iv, tag, ciphertext] = payload.split('.');
    expect(version).toBe('v1');
    expect(kid).toBe(keyId(Buffer.from(CURRENT, 'base64')));
    expect(Buffer.from(iv, 'base64url')).toHaveLength(12);
    expect(Buffer.from(tag, 'base64url')).toHaveLength(16);
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(encryption.decrypt(payload)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never reuses an IV', () => {
    expect(encryption.encrypt('same')).not.toBe(encryption.encrypt('same'));
  });

  it('binds additional authenticated data', () => {
    const payload = encryption.encrypt('secret', mfaSecretAad('user-1'));
    expect(encryption.decrypt(payload, mfaSecretAad('user-1'))).toBe('secret');
    expect(() => encryption.decrypt(payload, mfaSecretAad('user-2'))).toThrow(
      DecryptionError,
    );
    expect(() => encryption.decrypt(payload)).toThrow(DecryptionError);
  });

  it('detects tampering with ciphertext, tag or iv', () => {
    const payload = encryption.encrypt('secret');
    const parts = payload.split('.');
    const flip = (value: string) => {
      const bytes = Buffer.from(value, 'base64url');
      bytes[0] ^= 1;
      return bytes.toString('base64url');
    };
    for (const index of [2, 3, 4]) {
      const tampered = [...parts];
      tampered[index] = flip(tampered[index]);
      expect(() => encryption.decrypt(tampered.join('.'))).toThrow(
        DecryptionError,
      );
    }
  });

  it('decrypts payloads written with a previous key (rotation)', () => {
    const old = service(PREVIOUS).encrypt('rotated');
    expect(encryption.decrypt(old)).toBe('rotated');
    expect(encryption.needsReEncryption(old)).toBe(true);
    expect(encryption.needsReEncryption(encryption.encrypt('fresh'))).toBe(
      false,
    );
  });

  it('rejects unknown keys and malformed payloads with a detail-free error', () => {
    const foreign = service(Buffer.alloc(32, 1).toString('base64')).encrypt(
      'x',
    );
    for (const payload of [
      foreign,
      '',
      'v2.a.b.c.d',
      'v1.only.three',
      'x'.repeat(70_000),
    ]) {
      const attempt = () => encryption.decrypt(payload);
      expect(attempt).toThrow(DecryptionError);
      expect(attempt).toThrow('Decryption failed');
    }
  });

  it('builds a de-duplicated ring and validates key sizes', () => {
    expect(buildKeyRing([CURRENT, CURRENT, PREVIOUS])).toHaveLength(2);
    expect(() => buildKeyRing([Buffer.alloc(16).toString('base64')])).toThrow();
    expect(() => buildKeyRing([])).toThrow();
    const [key] = buildKeyRing([CURRENT]);
    expect(decryptWithRing([key], encryptWithKey(key, 'pure'))).toBe('pure');
  });
});
