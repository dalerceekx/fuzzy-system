import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { AuditAction } from '../../audit/audit-actions.js';
import { AuditService } from '../../audit/audit.service.js';
import { Errors } from '../../common/errors/app.exception.js';
import { maskPhone } from '../../common/phone.js';
import type { Env } from '../../config/env.js';
import { UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import {
  EncryptionService,
  mfaSecretAad,
} from '../../security/encryption.service.js';
import { RateLimitService } from '../../security/rate-limit.service.js';
import {
  SessionService,
  type SessionMeta,
} from '../../security/sessions/session.service.js';
import {
  TokenService,
  type MfaClaims,
  type MfaPurpose,
} from '../../security/tokens/token.service.js';
import { AuthKeys, mfaInvalid } from '../auth.constants.js';
import { LoginService, type LoginOutcome } from '../login.service.js';
import { base32Decode, base32Encode } from './base32.js';
import { generateTotpSecret, matchTotp, otpauthUrl } from './totp.js';

const MFA_USER_SELECT = {
  id: true,
  phone: true,
  role: true,
  status: true,
  isDemo: true,
  mfaEnabled: true,
  mfaSecretEnc: true,
  mfaPendingSecretEnc: true,
  mfaLastUsedStep: true,
  passwordChangedAt: true,
} as const;

/**
 * TOTP second factor for MFA_REQUIRED_ROLES. The mfaToken (issued by login
 * after a correct password) is single-use: its jti is claimed in Redis with
 * SET NX on success. Wrong codes are limited per token and per user. A code
 * is accepted only for a time step newer than the last accepted one
 * (atomic conditional UPDATE), so an observed code cannot be replayed.
 */
@Injectable()
export class MfaService {
  private readonly issuer: string;
  private readonly maxAttempts: number;
  private readonly tokenTtl: number;
  private readonly failureWindow: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly encryption: EncryptionService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly login: LoginService,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = config.get('MFA_ISSUER', { infer: true });
    this.maxAttempts = config.get('MFA_MAX_ATTEMPTS', { infer: true });
    this.tokenTtl = config.get('MFA_TOKEN_TTL_SECONDS', { infer: true });
    this.failureWindow = config.get('LOGIN_LOCKOUT_SECONDS', { infer: true });
  }

  /** Creates a pending secret (replacing an earlier unconfirmed one). */
  async setup(
    mfaToken: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const { user } = await this.resolve(mfaToken, 'setup');
    if (user.mfaEnabled) throw Errors.unauthorized();
    const secret = base32Encode(generateTotpSecret());
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, mfaEnabled: false, status: UserStatus.ACTIVE },
      data: {
        mfaPendingSecretEnc: this.encryption.encrypt(
          secret,
          mfaSecretAad(user.id),
        ),
      },
    });
    if (count !== 1) throw Errors.unauthorized();
    return {
      secret,
      otpauthUrl: otpauthUrl({
        issuer: this.issuer,
        account: maskPhone(user.phone),
        secretBase32: secret,
      }),
    };
  }

  /** Confirms the pending secret with a code, enables MFA and logs in. */
  async enable(
    mfaToken: string,
    code: string,
    meta: SessionMeta,
  ): Promise<LoginOutcome> {
    const { claims, user } = await this.resolve(mfaToken, 'setup');
    await this.guardAttempts(claims.jti, user.id);
    const pending = user.mfaPendingSecretEnc;
    const step =
      !user.mfaEnabled && pending
        ? matchTotp(this.secretBytes(pending, user.id), code)
        : null;
    if (step === null || pending === null) {
      return this.fail(user.id);
    }

    await this.claim(claims);
    const enabled = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: {
          id: user.id,
          mfaEnabled: false,
          mfaPendingSecretEnc: pending,
          status: UserStatus.ACTIVE,
        },
        data: {
          mfaSecretEnc: pending,
          mfaPendingSecretEnc: null,
          mfaEnabled: true,
          mfaLastUsedStep: step,
        },
      });
      if (count !== 1) return false;
      await this.audit.record(
        {
          action: AuditAction.AUTH_MFA_ENABLED,
          resourceType: 'user',
          resourceId: user.id,
          actorId: user.id,
          actorRole: user.role,
          newValue: { enabled: true },
        },
        tx,
      );
      return true;
    });
    if (!enabled) throw mfaInvalid();
    await this.rateLimit.reset(AuthKeys.mfaUserFailures(user.id));
    return this.login.completeLogin(user, meta, true);
  }

  /** Second step of a login for an enrolled user. */
  async verify(
    mfaToken: string,
    code: string,
    meta: SessionMeta,
  ): Promise<LoginOutcome> {
    const { claims, user } = await this.resolve(mfaToken, 'challenge');
    await this.guardAttempts(claims.jti, user.id);
    const step =
      user.mfaEnabled && user.mfaSecretEnc
        ? matchTotp(this.secretBytes(user.mfaSecretEnc, user.id), code, {
            afterStep: user.mfaLastUsedStep,
          })
        : null;
    if (step === null) return this.fail(user.id);

    // Atomic: of two requests with the same code only one advances the step.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        mfaEnabled: true,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    if (count !== 1) return this.fail(user.id);

    await this.claim(claims);
    await this.rateLimit.reset(AuthKeys.mfaUserFailures(user.id));
    return this.login.completeLogin(user, meta, true);
  }

  private async resolve(token: string, purpose: MfaPurpose) {
    const claims = await this.tokens.verifyMfa(token);
    if (claims.purpose !== purpose) throw Errors.unauthorized();
    if (await this.redis.exists(AuthKeys.mfaTokenUsed(claims.jti))) {
      throw Errors.unauthorized();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: MFA_USER_SELECT,
    });
    // A password change after the token was issued invalidates it too.
    const passwordChangedAfter =
      user?.passwordChangedAt &&
      Math.floor(user.passwordChangedAt.getTime() / 1000) > claims.iat;
    if (
      !user ||
      passwordChangedAfter ||
      !this.sessions.isUserAllowed(user, new Date())
    ) {
      throw Errors.unauthorized();
    }
    return { claims, user };
  }

  private async guardAttempts(jti: string, userId: string): Promise<void> {
    const byToken = await this.rateLimit.hit(
      AuthKeys.mfaTokenAttempts(jti),
      this.maxAttempts,
      this.tokenTtl,
    );
    if (!byToken.allowed) {
      throw Errors.tooManyRequests(byToken.retryAfterSeconds);
    }
    // Counted before the code is checked (reset on success), so parallel
    // requests cannot try more than maxAttempts codes per user and window.
    const byUser = await this.rateLimit.hit(
      AuthKeys.mfaUserFailures(userId),
      this.maxAttempts,
      this.failureWindow,
    );
    if (!byUser.allowed) {
      throw Errors.tooManyRequests(byUser.retryAfterSeconds);
    }
  }

  private async fail(userId: string): Promise<never> {
    await this.audit.record({
      action: AuditAction.AUTH_MFA_FAILED,
      resourceType: 'user',
      resourceId: userId,
      actorId: null,
      actorRole: null,
    });
    throw mfaInvalid();
  }

  /** Single use: only the first successful request may spend the token. */
  private async claim(claims: MfaClaims): Promise<void> {
    const ttl = Math.max(1, claims.exp - Math.floor(Date.now() / 1000) + 5);
    const claimed = await this.redis.set(
      AuthKeys.mfaTokenUsed(claims.jti),
      '1',
      'EX',
      ttl,
      'NX',
    );
    if (claimed !== 'OK') throw Errors.unauthorized();
  }

  private secretBytes(encrypted: string, userId: string): Buffer {
    return base32Decode(
      this.encryption.decrypt(encrypted, mfaSecretAad(userId)),
    );
  }
}
