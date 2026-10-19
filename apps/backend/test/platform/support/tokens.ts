import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { keyId } from '../../../src/security/crypto.js';

const jwt = new JwtService();

export interface CraftOptions {
  secret?: string;
  kid?: string | null;
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  sub?: string;
  sid?: string;
  typ?: string;
  iss?: string;
  aud?: string;
  /** Seconds from now; null → no exp claim. */
  expiresIn?: number | null;
  jti?: string;
  extra?: Record<string, unknown>;
}

/** Signs an arbitrary (possibly invalid) token for negative tests. */
export function craftToken(options: CraftOptions = {}): string {
  const secret = options.secret ?? process.env.JWT_ACCESS_SECRET ?? '';
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: options.sub ?? randomUUID(),
    sid: options.sid ?? randomUUID(),
    typ: options.typ ?? 'access',
    iss: options.iss ?? process.env.JWT_ISSUER,
    aud: options.aud ?? process.env.JWT_AUDIENCE,
    jti: options.jti ?? randomUUID(),
    iat: now,
    ...options.extra,
  };
  if (options.expiresIn !== null)
    payload.exp = now + (options.expiresIn ?? 600);
  const kid = options.kid === undefined ? keyId(secret) : options.kid;
  return jwt.sign(payload, {
    secret,
    algorithm: options.algorithm ?? 'HS256',
    ...(kid === null ? {} : { keyid: kid }),
  });
}

/** An unsigned `alg: none` token (must always be rejected). */
export function unsignedToken(
  payload: Record<string, unknown>,
  kid?: string,
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT', ...(kid ? { kid } : {}) })}.${encode(payload)}.`;
}

export function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

export function decodeHeader(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
