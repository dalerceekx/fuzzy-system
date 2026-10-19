import type { MockSmsProvider } from '../../src/sms/providers/mock-sms.provider.js';

/** The 6-digit code of the last SMS sent to `phone`, or undefined. */
export function lastOtp(
  sms: MockSmsProvider,
  phone: string,
): string | undefined {
  const message = sms.lastTo(phone);
  return message ? /\b(\d{6})\b/.exec(message.text)?.[1] : undefined;
}
