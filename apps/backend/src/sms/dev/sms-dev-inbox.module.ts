import { Module } from '@nestjs/common';
import { SmsDevInboxController } from './sms-dev-inbox.controller.js';

@Module({ controllers: [SmsDevInboxController] })
export class SmsDevInboxModule {}

/**
 * Evaluated against the loaded environment (process.env, after .env).
 * Unlike validateEnv, a missing NODE_ENV does not count as development: the
 * inbox hands out OTPs, so a host started without NODE_ENV must not get it.
 */
export function devInboxEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === 'development' &&
    env.SMS_ENABLED !== 'false' &&
    ((env.SMS_PROVIDER || 'mock') === 'mock' || env.SMS_MOCK_MODE === 'true')
  );
}
