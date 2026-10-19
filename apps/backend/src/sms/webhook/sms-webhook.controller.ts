import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Redis } from 'ioredis';
import { Public } from '../../common/decorators/public.decorator.js';
import { REDIS } from '../../redis/redis.module.js';
import { SmsDeliveryReportDto } from './sms-delivery-report.dto.js';
import { SmsDeliveryReports } from './sms-delivery-reports.js';
import {
  SMS_WEBHOOK_REPLAY_KEY,
  SmsWebhookGuard,
  type SmsWebhookRequest,
} from './sms-webhook.guard.js';

@ApiTags('sms')
@Public()
@Controller('sms/webhook')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(
    private readonly reports: SmsDeliveryReports,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Provider delivery report. Unknown ids get the same 200 as known ones,
   * so the endpoint is no oracle for message ids.
   */
  @Post('delivery')
  @HttpCode(200)
  @UseGuards(SmsWebhookGuard)
  async delivery(
    @Body() report: SmsDeliveryReportDto,
    @Req() req: SmsWebhookRequest,
  ): Promise<{ ok: true }> {
    let updated: number;
    try {
      updated = await this.reports.apply(report);
    } catch (err) {
      // Not processed: let the provider's retry (same signature) through.
      const replayKey = req[SMS_WEBHOOK_REPLAY_KEY];
      if (replayKey) await this.redis.del(replayKey).catch(() => undefined);
      throw err;
    }
    this.logger.log({ status: report.status, updated }, 'sms delivery report');
    return { ok: true };
  }
}
