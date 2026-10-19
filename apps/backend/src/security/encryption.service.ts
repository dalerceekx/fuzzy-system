import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { keyId } from './crypto.js';

// Payload: 'v1.<kid>.<ivB64u>.<tagB64u>.<ctB64u>' — AES-256-GCM, 96-bit IV,
// 128-bit tag; kid = first 8 hex chars of sha256(raw key bytes).
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PAYLOAD_LENGTH = 64 * 1024;

export interface EncryptionKey {
  kid: string;
  key: Buffer;
}

export class DecryptionError extends Error {
  constructor() {
    super('Decryption failed');
    this.name = 'DecryptionError';
  }
}

/** Builds a key ring from base64 keys; the first one encrypts. */
export function buildKeyRing(base64Keys: readonly string[]): EncryptionKey[] {
  const ring: EncryptionKey[] = [];
  for (const encoded of base64Keys) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Encryption keys must be 32 bytes');
    const kid = keyId(key);
    if (!ring.some((entry) => entry.kid === kid)) ring.push({ kid, key });
  }
  if (ring.length === 0) {
    throw new Error('At least one encryption key is required');
  }
  return ring;
}

export function encryptWithKey(
  { kid, key }: EncryptionKey,
  plaintext: string,
  aad?: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, kid, iv, tag, ciphertext]
    .map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part))
    .join('.');
}

export function decryptWithRing(
  ring: readonly EncryptionKey[],
  payload: string,
  aad?: string,
): string {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_LENGTH) {
    throw new DecryptionError();
  }
  const parts = payload.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) throw new DecryptionError();
  const [, kid, ivB64, tagB64, ctB64] = parts;
  const entry = ring.find((candidate) => candidate.kid === kid);
  if (!entry) throw new DecryptionError();

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ctB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError();
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', entry.key, iv, {
      authTagLength: TAG_BYTES,
    });
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** AAD binding an encrypted TOTP secret to its user row. */
export function mfaSecretAad(userId: string): string {
  return `user.mfa-secret:${userId}`;
}

/**
 * AES-256-GCM for data at rest (TOTP secrets, queued SMS payloads).
 * Encrypts with DATA_ENCRYPTION_KEY; decrypts with it or any key in
 * DATA_ENCRYPTION_KEYS_PREVIOUS (key rotation).
 */
@Injectable()
export class EncryptionService {
  private readonly ring: EncryptionKey[];

  constructor(config: ConfigService<Env, true>) {
    this.ring = buildKeyRing([
      config.get('DATA_ENCRYPTION_KEY', { infer: true }),
      ...config.get('DATA_ENCRYPTION_KEYS_PREVIOUS', { infer: true }),
    ]);
  }

  encrypt(plaintext: string, aad?: string): string {
    return encryptWithKey(this.ring[0], plaintext, aad);
  }

  /** Throws DecryptionError (no details) on any failure. */
  decrypt(payload: string, aad?: string): string {
    return decryptWithRing(this.ring, payload, aad);
  }

  /** True when the payload was not encrypted with the current key. */
  needsReEncryption(payload: string): boolean {
    return payload.split('.')[1] !== this.ring[0].kid;
  }
}
