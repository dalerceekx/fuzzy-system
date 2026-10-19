import { Global, Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import {
  SmsDevInboxModule,
  devInboxEnabled,
} from './dev/sms-dev-inbox.module.js';
import { HttpSmsProvider } from './providers/http-sms.provider.js';
import { EskizSmsProvider } from './providers/eskiz-sms.provider.js';
import { DisabledSmsProvider } from './providers/disabled-sms.provider.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import { SmsQueue } from './sms.queue.js';
import { SmsService } from './sms.service.js';
import { SMS_PROVIDER, type SmsProvider } from './sms.types.js';
import { SmsWorker } from './sms.worker.js';
import { SmsDeliveryReports } from './webhook/sms-delivery-reports.js';
import { SmsWebhookController } from './webhook/sms-webhook.controller.js';
import { SmsWebhookGuard } from './webhook/sms-webhook.guard.js';

function createProvider(config: ConfigService<Env, true>): SmsProvider {
  if (!config.get('SMS_ENABLED', { infer: true })) {
    return new DisabledSmsProvider();
  }
  const provider = config.get('SMS_PROVIDER', { infer: true });
  if (provider === 'mock' || config.get('SMS_MOCK_MODE', { infer: true })) {
    return new MockSmsProvider();
  }
  if (provider === 'eskiz') {
    return new EskizSmsProvider({
      baseUrl: config.get('ESKIZ_BASE_URL', { infer: true }),
      email: config.get('ESKIZ_EMAIL', { infer: true }) ?? '',
      password: config.get('ESKIZ_PASSWORD', { infer: true }) ?? '',
      from: config.get('ESKIZ_FROM', { infer: true }),
    });
  }
  // validateEnv guarantees URL, key and allowlisted https host for 'http'.
  return new HttpSmsProvider({
    apiUrl: config.get('SMS_API_URL', { infer: true }) ?? '',
    apiKey: config.get('SMS_API_KEY', { infer: true }) ?? '',
    sender: config.get('SMS_SENDER', { infer: true }),
    allowedHosts: config.get('SMS_ALLOWED_HOSTS', { infer: true }),
  });
}

@Global()
@Module({
  imports: [
    // The dev inbox route does not exist at all outside local development.
    ConditionalModule.registerWhen(SmsDevInboxModule, devInboxEnabled, {
      debug: false,
    }),
  ],
  controllers: [SmsWebhookController],
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: createProvider,
    },
    SmsQueue,
    SmsWorker,
    SmsService,
    SmsDeliveryReports,
    SmsWebhookGuard,
  ],
  exports: [SMS_PROVIDER, SmsService],
})
export class SmsModule {}
