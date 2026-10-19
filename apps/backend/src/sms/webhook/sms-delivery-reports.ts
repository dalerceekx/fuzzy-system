import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import { sha256Hex } from '../../security/crypto.js';

export interface SmsDeliveryReport {
  messageId: string;
  status: 'DELIVERED' | 'FAILED';
  errorCode?: string;
}

// The worker acknowledges the queue before it stores the provider id, so a
// fast report can arrive while no row carries that id yet.
const PENDING_TTL_SECONDS = 600;
const PENDING_PREFIX = 'sms:webhook:pending:';
const TOKEN = /^[A-Za-z0-9._:-]{1,100}$/;

const pendingKey = (messageId: string) =>
  `${PENDING_PREFIX}${sha256Hex(messageId)}`;

/**
 * Applies provider delivery reports to `sms_messages`. Only SENT messages
 * move on, which makes repeated or out-of-order reports harmless. A report
 * that matches no SENT row is parked briefly and applied by the worker as
 * soon as it records the provider id (applyPending).
 */
@Injectable()
export class SmsDeliveryReports {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Returns the number of rows updated (0 when parked). */
  async apply(report: SmsDeliveryReport): Promise<number> {
    const updated = await this.update(report);
    if (updated > 0) return updated;

    const key = pendingKey(report.messageId);
    await this.redis.set(
      key,
      JSON.stringify({ status: report.status, errorCode: report.errorCode }),
      'EX',
      PENDING_TTL_SECONDS,
    );
    // The worker may have stored the id between the update above and the
    // SET; retrying once here means one of the two sides always applies it.
    const retried = await this.update(report);
    if (retried > 0) await this.redis.del(key);
    return retried;
  }

  /** Called by the worker right after it stored `providerMessageId`. */
  async applyPending(messageId: string): Promise<void> {
    const raw = await this.redis.getdel(pendingKey(messageId));
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<SmsDeliveryReport>;
    if (parsed.status !== 'DELIVERED' && parsed.status !== 'FAILED') return;
    const errorCode =
      typeof parsed.errorCode === 'string' && TOKEN.test(parsed.errorCode)
        ? parsed.errorCode
        : undefined;
    await this.update({ messageId, status: parsed.status, errorCode });
  }

  private async update(report: SmsDeliveryReport): Promise<number> {
    const { count } = await this.prisma.smsMessage.updateMany({
      where: { providerMessageId: report.messageId, status: 'SENT' },
      data:
        report.status === 'DELIVERED'
          ? { status: 'DELIVERED', deliveredAt: new Date() }
          : {
              status: 'FAILED',
              lastError: `PROVIDER:${report.errorCode ?? 'UNKNOWN'}`,
            },
    });
    return count;
  }
}
