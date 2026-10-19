import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { Errors } from '../../common/errors/app.exception.js';
import { maskPhone } from '../../common/phone.js';
import type { Env } from '../../config/env.js';
import { MockSmsProvider } from '../providers/mock-sms.provider.js';
import { SMS_PROVIDER, type SmsProvider } from '../sms.types.js';

const INBOX_SIZE = 20;

export interface DevInboxMessage {
  to: string;
  text: string;
  sentAt: Date;
}

/**
 * Local development only: lets a developer read OTPs sent to the mock
 * provider. The module is imported only when NODE_ENV=development is set
 * explicitly and SMS_PROVIDER=mock; the runtime check below is a second line
 * of defense.
 */
@ApiExcludeController()
@Public()
@Controller('dev/sms-inbox')
export class SmsDevInboxController {
  private readonly enabled: boolean;

  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('NODE_ENV', { infer: true }) === 'development' &&
      provider instanceof MockSmsProvider;
  }

  @Get()
  inbox(): DevInboxMessage[] {
    if (!this.enabled || !(this.provider instanceof MockSmsProvider)) {
      throw Errors.notFound();
    }
    return this.provider
      .messages()
      .slice(-INBOX_SIZE)
      .reverse()
      .map(({ to, text, sentAt }) => ({ to: maskPhone(to), text, sentAt }));
  }
}
