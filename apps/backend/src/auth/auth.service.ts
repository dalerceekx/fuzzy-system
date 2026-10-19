import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination/index.js';
import { maskPhone } from '../common/phone.js';
import {
  USER_PUBLIC_SELECT,
  type PublicUser,
} from '../common/selects/user.select.js';
import {
  OtpPurpose,
  SessionRevokeReason,
  UserStatus,
} from '../generated/prisma/enums.js';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import { SessionService } from '../security/sessions/session.service.js';
import { SmsService } from '../sms/sms.service.js';
import {
  AuthKeys,
  AuthMessages,
  enforceIpLimit,
  enforceLimit,
  IpLimits,
  otpInvalid,
  passwordContainsPhoneError,
  PASSWORD_CHANGE_LIMIT,
} from './auth.constants.js';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyPhoneDto,
} from './dto/auth.dto.js';
import { DeferredWork } from './deferred-work.js';
import {
  OtpService,
  type IssuedOtp,
  type VerificationResponse,
} from './otp.service.js';
import { passwordContainsPhone } from './password-policy.js';

export interface SessionView {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Registration, phone verification, password recovery and account reads. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
    private readonly sms: SmsService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly deferred: DeferredWork,
  ) {}

  /**
   * Always answers 202 with the same body. A new phone gets a FARMER account
   * in PENDING_VERIFICATION; a still-pending phone is re-registered (latest
   * registration wins: new name/password, previous codes invalidated, and
   * the new code is bound to the new verificationId — so neither the earlier
   * registrant's id nor a code alone can activate it). Verified, blocked or
   * archived phones get a decoy id and no SMS. Everything that depends on
   * the phone's state runs after the response is decided (DeferredWork).
   */
  async register(
    dto: RegisterDto,
    ip: string | undefined,
  ): Promise<VerificationResponse> {
    if (passwordContainsPhone(dto.password, dto.phone)) {
      throw passwordContainsPhoneError();
    }
    await enforceIpLimit(this.rateLimit, IpLimits.register, ip);
    await this.otp.reserveSend(dto.phone, ip);
    await this.sms.consumeDailyQuota(dto.phone, ip);
    // Hashed on every branch so timing does not reveal registered numbers.
    const passwordHash = await this.passwords.hash(dto.password);

    const verificationId = randomUUID();
    await this.otp.startCooldown(verificationId);
    this.deferred.run('register', () =>
      this.registerAccount(dto, passwordHash, verificationId),
    );
    return this.otp.response(verificationId);
  }

  private async registerAccount(
    dto: RegisterDto,
    passwordHash: string,
    verificationId: string,
  ): Promise<void> {
    let issued: IssuedOtp | null = null;
    try {
      issued = await this.prisma.$transaction(async (tx) => {
        const [existing] = await tx.$queryRaw<
          Array<{ id: string; status: UserStatus }>
        >`SELECT id, status FROM users WHERE phone = ${dto.phone} FOR UPDATE`;
        if (existing && existing.status !== UserStatus.PENDING_VERIFICATION) {
          return null;
        }
        const user = existing
          ? await tx.user.update({
              where: { id: existing.id },
              data: { fullName: dto.fullName, passwordHash },
              select: { id: true, phone: true },
            })
          : await tx.user.create({
              // role/status are fixed here; the DTO cannot carry them.
              data: {
                phone: dto.phone,
                fullName: dto.fullName,
                passwordHash,
              },
              select: { id: true, phone: true },
            });
        const otp = await this.otp.issue(
          tx,
          user,
          OtpPurpose.PHONE_VERIFICATION,
          verificationId,
        );
        await this.audit.record(
          {
            action: AuditAction.AUTH_REGISTER,
            resourceType: 'user',
            resourceId: user.id,
            actorId: null,
            actorRole: null,
            newValue: {
              phoneMasked: maskPhone(user.phone),
              status: UserStatus.PENDING_VERIFICATION,
              reRegistration: Boolean(existing),
            },
          },
          tx,
        );
        return otp;
      });
    } catch (err) {
      // A concurrent registration of the same new phone won the race.
      if (!isUniqueViolation(err)) throw err;
    }
    if (issued) await this.otp.deliver(issued);
  }

  async verifyPhone(
    dto: VerifyPhoneDto,
    ip: string | undefined,
  ): Promise<{ message: string }> {
    await enforceIpLimit(this.rateLimit, IpLimits.verifyPhone, ip);
    const otp = await this.otp.check(
      dto.verificationId,
      dto.code,
      OtpPurpose.PHONE_VERIFICATION,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.otp.consume(tx, otp);
      const { count } = await tx.user.updateMany({
        where: { id: otp.userId, status: UserStatus.PENDING_VERIFICATION },
        data: { status: UserStatus.ACTIVE, phoneVerifiedAt: new Date() },
      });
      if (count !== 1) throw otpInvalid();
      await this.audit.record(
        {
          action: AuditAction.AUTH_PHONE_VERIFIED,
          resourceType: 'user',
          resourceId: otp.userId,
          actorId: otp.userId,
          newValue: { status: UserStatus.ACTIVE },
        },
        tx,
      );
    });
    // Login attempts made before verifying (answered as wrong credentials)
    // must not keep the now-verified owner locked out.
    await this.resetLoginLimits(otp.phone);
    return { message: AuthMessages.phoneVerified };
  }

  resendOtp(
    verificationId: string,
    ip: string | undefined,
  ): Promise<VerificationResponse> {
    return this.otp.resend(verificationId, ip);
  }

  /**
   * Same 202 for every phone; a code is sent only to ACTIVE, non-demo users.
   * The lookup, OTP and SMS run outside the request path (DeferredWork).
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    ip: string | undefined,
  ): Promise<VerificationResponse> {
    await enforceIpLimit(this.rateLimit, IpLimits.passwordForgot, ip);
    await this.otp.reserveSend(dto.phone, ip);
    await this.sms.consumeDailyQuota(dto.phone, ip);

    const verificationId = randomUUID();
    await this.otp.startCooldown(verificationId);
    this.deferred.run('password-forgot', () =>
      this.issueResetCode(dto.phone, verificationId),
    );
    return this.otp.response(verificationId);
  }

  private async issueResetCode(
    phone: string,
    verificationId: string,
  ): Promise<void> {
    let issued: IssuedOtp | null = null;
    try {
      issued = await this.issueResetCodeTx(phone, verificationId);
    } catch (err) {
      // A concurrent request for the same account issued the live code.
      if (!isUniqueViolation(err)) throw err;
    }
    if (issued) await this.otp.deliver(issued);
  }

  private issueResetCodeTx(
    phone: string,
    verificationId: string,
  ): Promise<IssuedOtp | null> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { phone },
        select: { id: true, phone: true, status: true, isDemo: true },
      });
      if (!user) return null;
      // Demo accounts use configured numbers that may belong to someone
      // else: never text them.
      const eligible = user.status === UserStatus.ACTIVE && !user.isDemo;
      const otp = eligible
        ? await this.otp.issue(
            tx,
            user,
            OtpPurpose.PASSWORD_RESET,
            verificationId,
          )
        : null;
      await this.audit.record(
        {
          action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
          resourceType: 'user',
          resourceId: user.id,
          actorId: null,
          actorRole: null,
          newValue: { phoneMasked: maskPhone(user.phone), smsSent: eligible },
        },
        tx,
      );
      return otp;
    });
  }

  /** Sets a new password and revokes every session of the account. */
  async resetPassword(
    dto: ResetPasswordDto,
    ip: string | undefined,
  ): Promise<{ message: string }> {
    await enforceIpLimit(this.rateLimit, IpLimits.passwordReset, ip);
    const otp = await this.otp.check(
      dto.verificationId,
      dto.code,
      OtpPurpose.PASSWORD_RESET,
    );
    if (passwordContainsPhone(dto.newPassword, otp.phone)) {
      throw passwordContainsPhoneError();
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.otp.consume(tx, otp);
      await this.otp.invalidateOthers(tx, otp.userId, otp.id);
      const { count } = await tx.user.updateMany({
        where: { id: otp.userId, status: UserStatus.ACTIVE },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      if (count !== 1) throw otpInvalid();
      const revoked = await this.sessions.revokeAllForUser(
        otp.userId,
        SessionRevokeReason.PASSWORD_RESET,
        { tx },
      );
      await this.audit.record(
        {
          action: AuditAction.AUTH_PASSWORD_RESET,
          resourceType: 'user',
          resourceId: otp.userId,
          actorId: otp.userId,
          newValue: { sessionsRevoked: revoked },
        },
        tx,
      );
    });
    // The owner proved control of the phone: lift a brute-force lockout.
    await this.resetLoginLimits(otp.phone);
    return { message: AuthMessages.passwordReset };
  }

  private async resetLoginLimits(phone: string): Promise<void> {
    await this.rateLimit.reset(AuthKeys.loginFailures(phone));
    await this.rateLimit.reset(AuthKeys.loginLock(phone));
  }

  /** Keeps the current session, revokes all others. */
  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    // Every attempt is counted before the password is verified (atomic
    // INCR) and the counter is reset on success, so a parallel burst cannot
    // try more than PASSWORD_CHANGE_LIMIT current passwords.
    const limitKey = AuthKeys.passwordChange(user.id);
    await enforceLimit(
      this.rateLimit,
      limitKey,
      PASSWORD_CHANGE_LIMIT.limit,
      PASSWORD_CHANGE_LIMIT.windowSeconds,
    );
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { phone: true, passwordHash: true },
    });
    if (!(await this.passwords.verify(dto.currentPassword, row.passwordHash))) {
      throw Errors.unauthorized(
        AuthMessages.wrongCurrentPassword,
        'INVALID_CREDENTIALS',
      );
    }
    if (passwordContainsPhone(dto.newPassword, row.phone)) {
      throw passwordContainsPhoneError();
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      // Conditional on the hash we verified: a concurrent change wins once.
      const { count } = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordHash: row.passwordHash,
          status: UserStatus.ACTIVE,
        },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      if (count !== 1) {
        throw Errors.unauthorized(
          AuthMessages.wrongCurrentPassword,
          'INVALID_CREDENTIALS',
        );
      }
      const revoked = await this.sessions.revokeAllForUser(
        user.id,
        SessionRevokeReason.PASSWORD_CHANGED,
        { exceptSessionId: user.sessionId, tx },
      );
      await this.audit.record(
        {
          action: AuditAction.AUTH_PASSWORD_CHANGED,
          resourceType: 'user',
          resourceId: user.id,
          newValue: { otherSessionsRevoked: revoked },
        },
        tx,
      );
    });
    await this.rateLimit.reset(limitKey);
  }

  me(user: AuthUser): Promise<PublicUser> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: USER_PUBLIC_SELECT,
    });
  }

  async listSessions(
    user: AuthUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<SessionView>> {
    const where = {
      userId: user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          ip: true,
          userAgent: true,
        },
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.session.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({ ...row, current: row.id === user.sessionId })),
      total,
      query,
    );
  }

  /** Own sessions only; anything else (or already revoked) is a 404. */
  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: sessionId, userId: user.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: SessionRevokeReason.LOGOUT,
        },
      });
      if (count !== 1) throw Errors.notFound();
      await this.audit.record(
        {
          action: AuditAction.AUTH_SESSION_REVOKED,
          resourceType: 'session',
          resourceId: sessionId,
          newValue: { current: sessionId === user.sessionId },
        },
        tx,
      );
    });
  }

  async logout(user: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revokeSession(
        user.sessionId,
        SessionRevokeReason.LOGOUT,
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AUTH_LOGOUT,
          resourceType: 'session',
          resourceId: user.sessionId,
        },
        tx,
      );
    });
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(
        user.id,
        SessionRevokeReason.LOGOUT_ALL,
        { tx },
      );
      await this.audit.record(
        {
          action: AuditAction.AUTH_LOGOUT_ALL,
          resourceType: 'user',
          resourceId: user.id,
          newValue: { sessionsRevoked: revoked },
        },
        tx,
      );
    });
  }
}
