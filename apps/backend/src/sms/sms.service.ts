import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rateLimitIpKey } from '../common/context/client-ip.js';
import { Errors } from '../common/errors/app.exception.js';
import { maskPhone } from '../common/phone.js';
import {
  secondsUntilNextTashkentDay,
  todayInTashkent,
} from '../common/time.js';
import type { Env } from '../config/env.js';
import { hashIdentifier } from '../security/crypto.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import { SmsQueue } from './sms.queue.js';
import { SmsWorker, sanitizedErrorCode } from './sms.worker.js';
import {
  SMS_PROVIDER,
  type OtpSmsPurpose,
  type SmsProvider,
} from './sms.types.js';

const QUOTA_WINDOW_SECONDS = 2 * 24 * 60 * 60;
// Share of one phone's daily quota a single IP may use, so one source can
// never exhaust a victim's quota (and block their OTPs) on its own.
const DAILY_LIMIT_PER_PHONE_AND_IP = 4;

export const DEFAULT_OTP_TEMPLATE =
  'RIIZQ: Tasdiqlash kodingiz: {code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.';

export function otpMessageText(
  code: string,
  template = DEFAULT_OTP_TEMPLATE,
): string {
  return template.replaceAll('{code}', code);
}

/**
 * Public SMS API used by the auth module. Quotas fail closed (Redis errors
 * propagate); sending never throws: SMS problems must not affect the
 * caller, which has already committed its transaction.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly limitPerPhone: number;
  private readonly limitPerIp: number;
  private readonly limitPerPhoneAndIp: number;
  private readonly messageTemplate: string;

  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly queue: SmsQueue,
    private readonly worker: SmsWorker,
    private readonly rateLimit: RateLimitService,
    config: ConfigService<Env, true>,
  ) {
    this.messageTemplate =
      config.get('SMS_OTP_TEMPLATE', { infer: true }) ?? DEFAULT_OTP_TEMPLATE;
    this.limitPerPhone = config.get('SMS_DAILY_LIMIT_PER_PHONE', {
      infer: true,
    });
    this.limitPerIp = config.get('SMS_DAILY_LIMIT_PER_IP', { infer: true });
    this.limitPerPhoneAndIp = Math.min(
      this.limitPerPhone,
      DAILY_LIMIT_PER_PHONE_AND_IP,
    );
  }

  /**
   * Daily per-phone and per-IP SMS quota (Tashkent calendar day). Counts
   * every request — also when the phone does not exist and nothing is sent —
   * so the response never reveals whether an account exists.
   * Because of that, the per-phone counter is a lockout vector: the per-IP
   * and per-(phone, IP) quotas are checked first and a request rejected by
   * either never touches it, so one source can use at most
   * DAILY_LIMIT_PER_PHONE_AND_IP of a victim's daily quota.
   * Throws 429 RATE_LIMITED.
   */
  async consumeDailyQuota(
    phone: string,
    ip: string | undefined,
  ): Promise<void> {
    const day = todayInTashkent();
    const ipKey = rateLimitIpKey(ip);
    const phoneHash = hashIdentifier(phone);
    const byIp = await this.rateLimit.hit(
      `rl:sms:ip:${ipKey}:${day}`,
      this.limitPerIp,
      QUOTA_WINDOW_SECONDS,
    );
    if (!byIp.allowed) {
      throw Errors.tooManyRequests(secondsUntilNextTashkentDay());
    }
    const byPhoneAndIp = await this.rateLimit.hit(
      `rl:sms:phone-ip:${phoneHash}:${ipKey}:${day}`,
      this.limitPerPhoneAndIp,
      QUOTA_WINDOW_SECONDS,
    );
    if (!byPhoneAndIp.allowed) {
      throw Errors.tooManyRequests(secondsUntilNextTashkentDay());
    }
    const byPhone = await this.rateLimit.hit(
      `rl:sms:phone:${phoneHash}:${day}`,
      this.limitPerPhone,
      QUOTA_WINDOW_SECONDS,
    );
    if (!byPhone.allowed) {
      throw Errors.tooManyRequests(secondsUntilNextTashkentDay());
    }
  }

  /**
   * Queues an OTP SMS. Call only after the transaction that created the OTP
   * has committed. Never throws (failures are logged with a masked phone).
   * In NODE_ENV=test the job is delivered before this resolves.
   */
  async sendOtp(params: {
    phone: string;
    code: string;
    purpose: OtpSmsPurpose;
    /** Original OTP deadline; queueing must not extend it. */
    expiresAt?: Date;
  }): Promise<void> {
    try {
      const smsId = await this.queue.enqueue({
        to: params.phone,
        text: otpMessageText(params.code, this.messageTemplate),
        purpose: params.purpose,
        provider: this.provider.name,
        expiresAt: params.expiresAt?.getTime(),
      });
      this.logger.log(
        {
          smsId,
          phone: maskPhone(params.phone),
          purpose: params.purpose,
          status: 'QUEUED',
        },
        'otp sms queued',
      );
      if (this.worker.inline) await this.worker.processNow(smsId);
      else this.worker.notify();
    } catch (err) {
      this.logger.error(
        {
          phone: maskPhone(params.phone),
          purpose: params.purpose,
          error: sanitizedErrorCode(err),
        },
        'otp sms could not be queued',
      );
    }
  }
}
