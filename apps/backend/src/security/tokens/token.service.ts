import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Errors } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { keyId } from '../crypto.js';

export type TokenType = 'access' | 'refresh' | 'mfa';
export type MfaPurpose = 'challenge' | 'setup';

export interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
  jti: string;
  iat: number;
  exp: number;
}

export interface RefreshClaims {
  sub: string;
  sid: string;
  typ: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

export interface MfaClaims {
  sub: string;
  typ: 'mfa';
  purpose: MfaPurpose;
  jti: string;
  iat: number;
  exp: number;
}

/** kid → secret; the first entry signs, every entry verifies. */
type KeyRing = {
  signing: { kid: string; secret: string };
  verify: Map<string, string>;
};

const ALGORITHM = 'HS256';
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_TOKEN_LENGTH = 4096;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildKeyRing(current: string, previous: readonly string[]): KeyRing {
  const verify = new Map<string, string>();
  for (const secret of [current, ...previous]) {
    const kid = keyId(secret);
    if (!verify.has(kid)) verify.set(kid, secret);
  }
  return { signing: { kid: keyId(current), secret: current }, verify };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * JWT issuing/verification. Payloads carry ids only — never a role, phone,
 * name or secret: the role is read from the database on every request.
 * Access and MFA tokens use the access key ring, refresh tokens their own.
 */
@Injectable()
export class TokenService {
  private readonly accessKeys: KeyRing;
  private readonly refreshKeys: KeyRing;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtl: number;
  private readonly mfaTtl: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessKeys = buildKeyRing(
      config.get('JWT_ACCESS_SECRET', { infer: true }),
      config.get('JWT_ACCESS_SECRETS_PREVIOUS', { infer: true }),
    );
    this.refreshKeys = buildKeyRing(
      config.get('JWT_REFRESH_SECRET', { infer: true }),
      config.get('JWT_REFRESH_SECRETS_PREVIOUS', { infer: true }),
    );
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.mfaTtl = config.get('MFA_TOKEN_TTL_SECONDS', { infer: true });
  }

  async signAccess(
    userId: string,
    sessionId: string,
  ): Promise<{ token: string; expiresIn: number }> {
    const token = await this.sign(
      this.accessKeys,
      userId,
      { sid: sessionId, typ: 'access' },
      {
        jwtid: randomUUID(),
        expiresIn: this.accessTtl,
      },
    );
    return { token, expiresIn: this.accessTtl };
  }

  /** `notAfter` is the absolute end of the session (token family). */
  async signRefresh(
    userId: string,
    sessionId: string,
    jti: string,
    notAfter: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const exp = Math.floor(notAfter.getTime() / 1000);
    if (exp <= Math.floor(Date.now() / 1000)) throw Errors.unauthorized();
    const token = await this.sign(
      this.refreshKeys,
      userId,
      { sid: sessionId, typ: 'refresh', exp },
      {
        jwtid: jti,
      },
    );
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async signMfa(
    userId: string,
    purpose: MfaPurpose,
  ): Promise<{ token: string; jti: string; expiresIn: number }> {
    const jti = randomUUID();
    const token = await this.sign(
      this.accessKeys,
      userId,
      { typ: 'mfa', purpose },
      {
        jwtid: jti,
        expiresIn: this.mfaTtl,
      },
    );
    return { token, jti, expiresIn: this.mfaTtl };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const claims = await this.verify(token, this.accessKeys, 'access');
    if (!isUuid(claims.sid)) throw Errors.unauthorized();
    return claims as unknown as AccessClaims;
  }

  async verifyRefresh(token: string): Promise<RefreshClaims> {
    const claims = await this.verify(token, this.refreshKeys, 'refresh');
    if (!isUuid(claims.sid)) throw Errors.unauthorized();
    return claims as unknown as RefreshClaims;
  }

  async verifyMfa(token: string): Promise<MfaClaims> {
    const claims = await this.verify(token, this.accessKeys, 'mfa');
    if (claims.purpose !== 'challenge' && claims.purpose !== 'setup') {
      throw Errors.unauthorized();
    }
    return claims as unknown as MfaClaims;
  }

  private sign(
    ring: KeyRing,
    subject: string,
    payload: Record<string, unknown>,
    options: { jwtid: string; expiresIn?: number },
  ): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: ring.signing.secret,
      algorithm: ALGORITHM,
      keyid: ring.signing.kid,
      issuer: this.issuer,
      audience: this.audience,
      subject,
      ...options,
    });
  }

  /** Any failure → the same 401, without saying which check failed. */
  private async verify(
    token: unknown,
    ring: KeyRing,
    typ: TokenType,
  ): Promise<Record<string, unknown>> {
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_LENGTH ||
      !JWT_SHAPE.test(token)
    ) {
      throw Errors.unauthorized();
    }
    let header: { alg?: unknown; kid?: unknown } | undefined;
    try {
      header = this.jwt.decode(token, { complete: true })?.header;
    } catch {
      throw Errors.unauthorized();
    }
    // Only HS256 with a known kid; `alg: none` and RS/HS confusion never
    // reach the signature check.
    if (header?.alg !== ALGORITHM || typeof header.kid !== 'string') {
      throw Errors.unauthorized();
    }
    const secret = ring.verify.get(header.kid);
    if (!secret) throw Errors.unauthorized();

    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret,
        algorithms: [ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
    } catch {
      throw Errors.unauthorized();
    }
    if (typeof claims !== 'object' || claims === null) {
      throw Errors.unauthorized();
    }
    const record = claims as Record<string, unknown>;
    if (
      record.typ !== typ ||
      !isUuid(record.sub) ||
      !isUuid(record.jti) ||
      typeof record.exp !== 'number' ||
      typeof record.iat !== 'number'
    ) {
      throw Errors.unauthorized();
    }
    return record;
  }
}
