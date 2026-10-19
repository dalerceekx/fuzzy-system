import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone } from '../common/phone.js';
import type { Env } from '../config/env.js';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service.js';
import { SmsQueue, type ClaimedJob, type SmsJob } from './sms.queue.js';
import {
  SMS_PROVIDER,
  SmsProviderError,
  type SmsProvider,
} from './sms.types.js';
import { SmsDeliveryReports } from './webhook/sms-delivery-reports.js';

const POLL_INTERVAL_MS = 1_000;
const ERROR_BACKOFF_MS = 5_000;
const RECOVERY_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type SmsOutcome =
  | { status: 'sent' }
  | { status: 'failed' }
  | { status: 'retry'; delayMs: number };

/** Exponential backoff with jitter; `attempt` = attempts made so far (≥ 1). */
export function retryDelayMs(
  attempt: number,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    MAX_RETRY_DELAY_MS,
    baseMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/**
 * Error class/code only, safe to log and to store in `sms_messages.last_error`
 * (messages of arbitrary errors may contain URLs, phones or keys).
 */
export function sanitizedErrorCode(err: unknown): string {
  const code =
    err instanceof SmsProviderError
      ? err.code
      : err instanceof Error
        ? err.name
        : 'UNKNOWN';
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'UNKNOWN';
}

/**
 * Sends queued SMS through the provider: retries with backoff up to
 * SMS_MAX_SEND_ATTEMPTS, then marks the message FAILED (dead letter).
 * Runs as a background loop, except in NODE_ENV=test where SmsService
 * processes each job inline (processNow) so tests can read the inbox.
 */
@Injectable()
export class SmsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SmsWorker.name);
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  readonly inline: boolean;
  private running = false;
  private loop?: Promise<void>;
  private wakeUp?: () => void;

  constructor(
    private readonly queue: SmsQueue,
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly reports: SmsDeliveryReports,
    config: ConfigService<Env, true>,
  ) {
    this.inline = config.get('NODE_ENV', { infer: true }) === 'test';
    this.maxAttempts = config.get('SMS_MAX_SEND_ATTEMPTS', { infer: true });
    // Inline retries block the caller, so they back off only briefly.
    this.retryBaseMs = this.inline ? 10 : 2_000;
  }

  onApplicationBootstrap(): void {
    if (!this.inline) this.start();
  }

  // onModuleDestroy runs before Redis/Prisma close (onApplicationShutdown),
  // so an in-flight send can finish and be acknowledged.
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.logger.log('sms worker started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeUp?.();
    await this.loop;
    this.loop = undefined;
    this.logger.log('sms worker stopped');
  }

  /** Signals that a job was queued (skips the idle wait). */
  notify(): void {
    this.wakeUp?.();
  }

  /** Processes one specific job until it is sent or given up. */
  async processNow(id: string): Promise<void> {
    for (;;) {
      const claimed = await this.queue.claim(id);
      if (!claimed) return;
      const outcome = await this.handle(claimed);
      if (outcome.status !== 'retry') return;
      await sleep(outcome.delayMs);
    }
  }

  /** Claims and processes the next due job; false when none is due. */
  async tick(): Promise<boolean> {
    const claimed = await this.queue.claimNext();
    if (!claimed) return false;
    await this.handle(claimed);
    return true;
  }

  private async run(): Promise<void> {
    let nextRecovery = 0;
    while (this.running) {
      try {
        if (Date.now() >= nextRecovery) {
          const requeued = await this.queue.recoverStale();
          if (requeued > 0) {
            this.logger.warn({ requeued }, 'stale sms jobs requeued');
          }
          nextRecovery = Date.now() + RECOVERY_INTERVAL_MS;
        }
        if (!(await this.tick())) await this.idle(POLL_INTERVAL_MS);
      } catch (err) {
        this.logger.error(
          { error: sanitizedErrorCode(err) },
          'sms worker iteration failed',
        );
        await this.idle(ERROR_BACKOFF_MS);
      }
    }
  }

  private async handle(claimed: ClaimedJob): Promise<SmsOutcome> {
    if (!claimed.job) {
      await this.queue.deadLetter(claimed.id);
      await this.record(claimed.id, {
        status: 'FAILED',
        lastError: claimed.reason,
      });
      this.logger.warn(
        { smsId: claimed.id, status: 'FAILED', reason: claimed.reason },
        'otp sms dropped',
      );
      return { status: 'failed' };
    }

    const job: SmsJob = { ...claimed.job, attempt: claimed.job.attempt + 1 };
    const logContext = {
      smsId: job.smsMessageId,
      phone: maskPhone(job.to),
      purpose: job.purpose,
      attempt: job.attempt,
    };

    let providerMessageId: string;
    // Fail closed if Redis is unavailable: the network request must never
    // start without a durable marker. Marker survives lease recovery/ack
    // failure, preventing duplicate charged sends after a worker crash.
    if (
      this.provider.requiresSubmissionGuard &&
      !(await this.queue.beginSubmission(job.smsMessageId))
    ) {
      return this.onSendError(
        job,
        new SmsProviderError('SUBMISSION_UNCERTAIN', false),
        logContext,
      );
    }
    try {
      const expiresAt = job.expiresAt ?? job.createdAt + this.queue.maxAgeMs;
      if (Date.now() >= expiresAt) {
        throw new SmsProviderError('OTP_EXPIRED', false);
      }
      ({ providerMessageId } = await this.provider.send({
        to: job.to,
        text: job.text,
        expiresAt,
      }));
    } catch (err) {
      return this.onSendError(job, err, logContext);
    }

    // Acknowledge before touching the database: a failed status update must
    // never cause the same OTP to be sent twice.
    await this.queue.ack(job.smsMessageId);
    await this.markSent(job, providerMessageId);
    // SENT means provider accepted, not handset delivery (DELIVERED).
    this.logger.log(
      { ...logContext, status: 'SENT' },
      'otp sms accepted by provider',
    );
    return { status: 'sent' };
  }

  private async onSendError(
    job: SmsJob,
    err: unknown,
    logContext: Record<string, unknown>,
  ): Promise<SmsOutcome> {
    const error = sanitizedErrorCode(err);
    const retryable = err instanceof SmsProviderError && err.retryable;
    const delayMs = retryDelayMs(job.attempt, this.retryBaseMs);
    const stillValid =
      Date.now() + delayMs <
      (job.expiresAt ?? job.createdAt + this.queue.maxAgeMs);

    if (retryable && stillValid && job.attempt < this.maxAttempts) {
      await this.queue.retry(job, delayMs);
      await this.record(job.smsMessageId, {
        attempts: job.attempt,
        lastError: error,
      });
      this.logger.warn(
        { ...logContext, status: 'QUEUED', error, retryInMs: delayMs },
        'otp sms send failed, retrying',
      );
      return { status: 'retry', delayMs };
    }

    await this.queue.deadLetter(job.smsMessageId);
    await this.record(job.smsMessageId, {
      status: 'FAILED',
      attempts: job.attempt,
      lastError: error,
    });
    this.logger.warn(
      { ...logContext, status: 'FAILED', error },
      'otp sms delivery failed',
    );
    return { status: 'failed' };
  }

  private async markSent(
    job: SmsJob,
    providerMessageId: string,
  ): Promise<void> {
    const data = {
      status: 'SENT' as const,
      attempts: job.attempt,
      sentAt: new Date(),
      lastError: null,
    };
    try {
      await this.prisma.smsMessage.update({
        where: { id: job.smsMessageId },
        data: { ...data, providerMessageId },
      });
    } catch (err) {
      // A provider reusing ids must not leave the message looking unsent.
      if (!isUniqueViolation(err)) {
        return this.logRecordError(job.smsMessageId, err);
      }
      return this.record(job.smsMessageId, data);
    }
    // A delivery report may have arrived before the id was stored.
    await this.reports
      .applyPending(providerMessageId)
      .catch((err: unknown) => this.logRecordError(job.smsMessageId, err));
  }

  /** Best-effort status update: the queue state is already final. */
  private async record(
    id: string,
    data: {
      status?: 'SENT' | 'FAILED';
      attempts?: number;
      lastError?: string | null;
      sentAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.smsMessage
      .update({ where: { id }, data })
      .catch((err: unknown) => this.logRecordError(id, err));
  }

  private logRecordError(id: string, err: unknown): void {
    this.logger.error(
      { smsId: id, error: sanitizedErrorCode(err) },
      'sms status update failed',
    );
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakeUp = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakeUp = done;
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
