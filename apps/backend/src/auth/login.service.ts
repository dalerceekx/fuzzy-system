import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { isMfaRequiredRole } from '../common/auth/roles.js';
import { Errors } from '../common/errors/app.exception.js';
import { maskPhone } from '../common/phone.js';
import {
  USER_PUBLIC_SELECT,
  type PublicUser,
} from '../common/selects/user.select.js';
import type { Env } from '../config/env.js';
import { UserStatus, type UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import {
  SessionService,
  type IssuedTokens,
  type SessionMeta,
} from '../security/sessions/session.service.js';
import { TokenService } from '../security/tokens/token.service.js';
import {
  AuthKeys,
  AuthMessages,
  invalidCredentials,
} from './auth.constants.js';
import type { LoginDto } from './dto/auth.dto.js';

export interface MfaChallenge {
  status: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  mfaToken: string;
  mfaTokenExpiresIn: number;
}

export type LoginOutcome =
  | { kind: 'mfa'; challenge: MfaChallenge }
  | { kind: 'session'; tokens: IssuedTokens; user: PublicUser };

type FailureReason =
  | 'unknown_phone'
  | 'invalid_password'
  | 'phone_not_verified'
  | 'account_unavailable';

/**
 * Password login. Two independent brute-force limits: per client IP, and
 * per account keyed by the normalized phone's hash — applied whether or not
 * the phone is registered, so lockouts cannot be used to enumerate numbers.
 * Every credential failure looks the same (401 INVALID_CREDENTIALS, equal
 * timing via PasswordService.verifyDummy), and so does a pending account;
 * ACCOUNT_BLOCKED is only revealed after a correct password.
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);
  private readonly perIpLimit: number;
  private readonly perIpWindow: number;
  private readonly maxFailures: number;
  private readonly lockoutSeconds: number;
  private readonly demoEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.perIpLimit = config.get('LOGIN_RATE_LIMIT_PER_IP', { infer: true });
    this.perIpWindow = config.get('LOGIN_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
    this.maxFailures = config.get('LOGIN_MAX_FAILED_ATTEMPTS', { infer: true });
    this.lockoutSeconds = config.get('LOGIN_LOCKOUT_SECONDS', { infer: true });
    this.demoEnabled = config.get('DEMO_ACCOUNTS_ENABLED', { infer: true });
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<LoginOutcome> {
    const byIp = await this.rateLimit.hit(
      AuthKeys.loginIp(meta.ip),
      this.perIpLimit,
      this.perIpWindow,
    );
    if (!byIp.allowed) throw Errors.tooManyRequests(byIp.retryAfterSeconds);

    // Checked before the password: while locked, even the right password
    // gets 429, so guessing during a lockout is useless.
    const lockedFor = await this.rateLimit.lockedFor(
      AuthKeys.loginLock(dto.phone),
    );
    if (lockedFor > 0) throw await this.lockedOut(dto.phone, lockedFor);
    // Every attempt is counted before the password is checked (atomic INCR),
    // so a parallel burst cannot try more than maxFailures passwords.
    const attempt = await this.rateLimit.hit(
      AuthKeys.loginFailures(dto.phone),
      this.maxFailures,
      this.lockoutSeconds,
    );
    if (!attempt.allowed) {
      await this.lock(dto.phone);
      throw await this.lockedOut(dto.phone, this.lockoutSeconds);
    }

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      select: {
        id: true,
        role: true,
        status: true,
        isDemo: true,
        mfaEnabled: true,
        passwordHash: true,
      },
    });
    const passwordOk = user
      ? await this.passwords.verify(dto.password, user.passwordHash)
      : await this.passwords.verifyDummy(dto.password);

    if (!user || !passwordOk) {
      await this.recordFailure(
        dto.phone,
        attempt.count,
        user?.id ?? null,
        user ? 'invalid_password' : 'unknown_phone',
      );
      throw invalidCredentials();
    }
    // A pending account looks exactly like a wrong password. Anyone can
    // register any phone with a password of their choice, so a distinct
    // answer here would reveal that the phone was not registered before
    // (an already registered phone keeps its owner's password). The client
    // that just registered continues with verify-phone instead.
    if (
      user.status === UserStatus.ARCHIVED ||
      user.status === UserStatus.PENDING_VERIFICATION ||
      (user.isDemo && !this.demoEnabled)
    ) {
      await this.recordFailure(
        dto.phone,
        attempt.count,
        user.id,
        user.status === UserStatus.PENDING_VERIFICATION
          ? 'phone_not_verified'
          : 'account_unavailable',
      );
      throw invalidCredentials();
    }
    if (user.status === UserStatus.BLOCKED) {
      throw Errors.forbidden(AuthMessages.accountBlocked, 'ACCOUNT_BLOCKED');
    }

    await this.rateLimit.reset(AuthKeys.loginFailures(dto.phone));
    await this.rehashIfNeeded(user.id, user.passwordHash, dto.password);

    if (isMfaRequiredRole(user.role)) {
      const purpose = user.mfaEnabled ? 'challenge' : 'setup';
      const mfa = await this.tokens.signMfa(user.id, purpose);
      return {
        kind: 'mfa',
        challenge: {
          status: user.mfaEnabled ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED',
          mfaToken: mfa.token,
          mfaTokenExpiresIn: mfa.expiresIn,
        },
      };
    }
    return this.completeLogin(user, meta, false);
  }

  /** Creates the session (token family) and records the login. */
  async completeLogin(
    user: { id: string; role: UserRole },
    meta: SessionMeta,
    mfaVerified: boolean,
  ): Promise<LoginOutcome> {
    const tokens = await this.sessions.createSession(user, {
      ...meta,
      mfaVerified,
    });
    const publicUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: USER_PUBLIC_SELECT,
    });
    await this.audit.record({
      action: AuditAction.AUTH_LOGIN_SUCCESS,
      resourceType: 'user',
      resourceId: user.id,
      actorId: user.id,
      actorRole: publicUser.role,
      newValue: { sessionId: tokens.sessionId, twoFactor: mfaVerified },
    });
    return { kind: 'session', tokens, user: publicUser };
  }

  private async recordFailure(
    phone: string,
    failures: number,
    userId: string | null,
    reason: FailureReason,
  ): Promise<void> {
    if (failures >= this.maxFailures) await this.lock(phone);
    await this.audit.record({
      action: AuditAction.AUTH_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: userId,
      actorId: null,
      actorRole: null,
      newValue: { phoneMasked: maskPhone(phone), reason },
    });
  }

  private async lock(phone: string): Promise<void> {
    await this.rateLimit.lock(AuthKeys.loginLock(phone), this.lockoutSeconds);
    await this.rateLimit.reset(AuthKeys.loginFailures(phone));
  }

  private async lockedOut(phone: string, seconds: number) {
    await this.audit.record({
      action: AuditAction.AUTH_LOGIN_LOCKED,
      resourceType: 'user',
      resourceId: null,
      actorId: null,
      actorRole: null,
      newValue: { phoneMasked: maskPhone(phone) },
    });
    return Errors.tooManyRequests(
      seconds,
      AuthMessages.accountLocked,
      'ACCOUNT_LOCKED',
    );
  }

  /** Upgrades legacy/low-cost hashes; best effort, never fails the login. */
  private async rehashIfNeeded(
    userId: string,
    storedHash: string,
    password: string,
  ): Promise<void> {
    if (!this.passwords.needsRehash(storedHash)) return;
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, passwordHash: storedHash },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    } catch {
      this.logger.warn({ userId }, 'password rehash failed');
    }
  }
}
