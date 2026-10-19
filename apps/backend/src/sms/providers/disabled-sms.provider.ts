import { SmsProviderError, type SmsProvider } from '../sms.types.js';

/** An explicit disabled switch must never silently deliver through mock. */
export class DisabledSmsProvider implements SmsProvider {
  readonly name = 'disabled';

  send(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new SmsProviderError('SMS_DISABLED', false));
  }
}
