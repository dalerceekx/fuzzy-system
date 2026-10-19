import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Errors } from '../common/errors/app.exception.js';
import type { Env } from '../config/env.js';
import { OtpPurpose, UserStatus } from '../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import {
  generateNumericCode,
  hashIdentifier,
  hmacSha256Hex,
  safeEqual,
} from '../security/crypto.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import { SmsService } from '../sms/sms.service.js';
import {
  AuthKeys,
  AuthMessages,
  enforceIpLimit,
  IpLimits,
  otpInvalid,
} from './auth.constants.js';
import { DeferredWork } from './deferred-work.js';
import { OtpStore } from './otp.store.js';

/** A freshly generated code; deliver it only after the transaction commits. */
export interface IssuedOtp {
  id: string;
  code: string;
  phone: string;
  purpose: OtpPurpose;
  expiresAt: Date;
}

export interface VerificationResponse {
  verificationId: string;
  expiresIn: number;
  resendAfter: number;
  message: string;
}

export interface CheckedOtp {
  id: string;
  userId: string;
  phone: string;
  codeHash: string;
}

// The user state an OTP purpose is meant for; any other state makes the
// code useless (e.g. a pending user who got blocked meanwhile).
const STATUS_FOR_PURPOSE: Record<OtpPurpose, UserStatus> = {
  [OtpPurpose.PHONE_VERIFICATION]: UserStatus.PENDING_VERIFICATION,
  [OtpPurpose.PASSWORD_RESET]: UserStatus.ACTIVE,
};

const RESEND_COUNT_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * One-time SMS codes. The row id is the client's `verificationId`; only
 * HMAC(OTP_PEPPER, id:code) is stored, so a database dump cannot be used to
 * brute-force codes offline, and a code is bound to its own row.
 */
@Injectable()
export class OtpService {
  private readonly pepper: string;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly cooldownSeconds: number;
  private readonly maxSends: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly sms: SmsService,
    private readonly deferred: DeferredWork,
    private readonly store: OtpStore,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('OTP_PEPPER', { infer: true });
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.cooldownSeconds = config.get('OTP_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    });
    this.maxSends = config.get('OTP_MAX_SENDS', { infer: true });
  }

  /** The uniform 202 body of register / forgot / resend. */
  response(verificationId: string): VerificationResponse {
    return {
      verificationId,
      expiresIn: this.ttlSeconds,
      resendAfter: this.cooldownSeconds,
      message: AuthMessages.verificationSent,
    };
  }

  /**
   * Replaces the user's live code for `purpose` (call inside the caller's
   * transaction). Older live codes are invalidated first, which also keeps
   * the "one live code per user and purpose" unique index satisfied.
   */
  async issue(
    tx: Tx,
    user: { id: string; phone: string },
    purpose: OtpPurpose,
    id: string = randomUUID(),
  ): Promise<IssuedOtp> {
    const now = new Date();
    const previous = await tx.otpCode.findFirst({
      where: { userId: user.id, purpose },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    await tx.otpCode.updateMany({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
    // A new verification id must not accidentally reuse the previous code.
    // Its previous HMAC can be compared without recovering plaintext.
    let code: string;
    do {
      code = generateNumericCode(6);
    } while (
      previous &&
      safeEqual(this.digest(previous.id, code), previous.codeHash)
    );
    const codeHash = this.digest(id, code);
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    await tx.otpCode.create({
      data: {
        id,
        userId: user.id,
        phone: user.phone,
        purpose,
        codeHash,
        maxAttempts: this.maxAttempts,
        lastSentAt: now,
        createdAt: now,
        expiresAt,
      },
    });
    // Keep this inside the transaction: Redis failure must roll back issuance.
    // An orphan verifier from a rolled-back transaction cannot pass the DB gate.
    await this.store.initialize(id, codeHash, this.maxAttempts, expiresAt);
    return { id, code, phone: user.phone, purpose, expiresAt };
  }

  reserveSend(phone: string, ip: string | undefined): Promise<void> {
    return this.store.reserveSend(phone, ip);
  }

  /**
   * Starts the resend cooldown of a verification id. Called for decoy ids
   * too, so /otp/resend answers the same for real and unknown ids.
   */
  startCooldown(verificationId: string): Promise<void> {
    return this.rateLimit.lock(
      AuthKeys.otpResendCooldown(verificationId),
      this.cooldownSeconds,
    );
  }

  /** Sends the SMS; never throws on delivery failure. */
  deliver(otp: IssuedOtp): Promise<void> {
    return this.sms.sendOtp({
      phone: otp.phone,
      code: otp.code,
      purpose: otp.purpose,
      expiresAt: otp.expiresAt,
    });
  }

  /**
   * Spends one attempt atomically (the UPDATE only matches a live code with
   * attempts left), then compares the digest in constant time. Unknown,
   * consumed, invalidated, expired, exhausted and wrong codes all fail the
   * same way. The attempt is committed before the comparison, so parallel
   * guesses cannot exceed max_attempts.
   */
  async check(
    verificationId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<CheckedOtp> {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; userId: string; phone: string; codeHash: string }>
    >`
      UPDATE otp_codes
      SET attempts = attempts + 1
      WHERE id = ${verificationId}::uuid
        AND purpose = ${purpose}::"OtpPurpose"
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > ${now}
        AND attempts < max_attempts
      RETURNING id, user_id AS "userId", phone, code_hash AS "codeHash"`;
    const row = rows[0];
    const matches = safeEqual(
      this.digest(verificationId, code),
      row?.codeHash ?? '',
    );
    if (!row) throw otpInvalid();
    if (!(await this.store.verify(row.id, row.codeHash, matches)))
      throw otpInvalid();
    return {
      id: row.id,
      userId: row.userId,
      phone: row.phone,
      codeHash: row.codeHash,
    };
  }

  /** Marks the code used; exactly one caller can win (replay-safe). */
  async consume(tx: Tx, checked: CheckedOtp): Promise<void> {
    const now = new Date();
    const { count } = await tx.otpCode.updateMany({
      where: {
        id: checked.id,
        // A check made before a concurrent resend cannot consume its new code.
        codeHash: checked.codeHash,
        consumedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (count !== 1) throw otpInvalid();
  }

  /** Invalidates every other live code of the user (all purposes). */
  async invalidateOthers(
    tx: Tx,
    userId: string,
    keepId: string,
  ): Promise<void> {
    await tx.otpCode.updateMany({
      where: {
        userId,
        id: { not: keepId },
        consumedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: new Date() },
    });
  }

  /**
   * New code for an existing verification id (new digest, new expiry,
   * attempts reset). Real and unknown ids pass the same limits in the same
   * order — per-IP, cooldown, send count, daily SMS quota — and get the same
   * answer; only a live code whose user is still in the right state is
   * actually re-sent, outside the request path (see DeferredWork).
   */
  async resend(
    verificationId: string,
    ip: string | undefined,
  ): Promise<VerificationResponse> {
    await enforceIpLimit(this.rateLimit, IpLimits.otpResend, ip);

    const locked = await this.rateLimit.acquireLock(
      AuthKeys.otpResendCooldown(verificationId),
      this.cooldownSeconds,
    );
    if (!locked) {
      throw Errors.tooManyRequests(
        await this.rateLimit.lockedFor(
          AuthKeys.otpResendCooldown(verificationId),
        ),
      );
    }
    const sends = await this.rateLimit.hit(
      AuthKeys.otpResendCount(verificationId),
      this.maxSends - 1,
      RESEND_COUNT_WINDOW_SECONDS,
    );
    if (!sends.allowed) throw Errors.tooManyRequests(sends.retryAfterSeconds);

    const existing = await this.prisma.otpCode.findUnique({
      where: { id: verificationId },
      select: { phone: true },
    });
    await this.reserveSend(
      existing?.phone ?? `unknown:${hashIdentifier(verificationId)}`,
      ip,
    );
    // Unknown ids still consume the per-IP SMS quota (the per-phone counter
    // they touch is keyed by the id and never matches a real phone).
    await this.sms.consumeDailyQuota(
      existing?.phone ?? `unknown:${hashIdentifier(verificationId)}`,
      ip,
    );

    if (existing) {
      this.deferred.run('otp-resend', async () => {
        const issued = await this.regenerate(verificationId);
        if (issued) await this.deliver(issued);
      });
    }
    return this.response(verificationId);
  }

  private async regenerate(verificationId: string): Promise<IssuedOtp | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{
          phone: string;
          purpose: OtpPurpose;
          sendCount: number;
          lastSentAt: Date;
          userStatus: UserStatus;
          codeHash: string;
        }>
      >`
        SELECT o.phone, o.purpose, o.send_count AS "sendCount", o.code_hash AS "codeHash",
               o.last_sent_at AS "lastSentAt", u.status AS "userStatus"
        FROM otp_codes o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = ${verificationId}::uuid
          AND o.consumed_at IS NULL
          AND o.invalidated_at IS NULL
        FOR UPDATE OF o`;
      const now = new Date();
      if (
        !row ||
        row.userStatus !== STATUS_FOR_PURPOSE[row.purpose] ||
        row.sendCount >= this.maxSends ||
        now.getTime() - row.lastSentAt.getTime() < this.cooldownSeconds * 1000
      ) {
        return null;
      }
      let code: string;
      do {
        code = generateNumericCode(6);
      } while (safeEqual(this.digest(verificationId, code), row.codeHash));
      const codeHash = this.digest(verificationId, code);
      const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
      await tx.otpCode.update({
        where: { id: verificationId },
        data: {
          codeHash,
          attempts: 0,
          sendCount: { increment: 1 },
          lastSentAt: now,
          expiresAt,
        },
      });
      await this.store.initialize(
        verificationId,
        codeHash,
        this.maxAttempts,
        expiresAt,
      );
      return {
        id: verificationId,
        code,
        phone: row.phone,
        purpose: row.purpose,
        expiresAt,
      };
    });
  }

  private digest(id: string, code: string): string {
    return hmacSha256Hex(this.pepper, `${id}:${code}`);
  }
}
