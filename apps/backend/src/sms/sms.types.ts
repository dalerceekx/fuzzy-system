export type OtpSmsPurpose = 'PHONE_VERIFICATION' | 'PASSWORD_RESET';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessageInput {
  to: string;
  text: string;
  /** Absolute OTP deadline, checked again after provider authentication. */
  expiresAt?: number;
}

export interface SmsProvider {
  readonly name: string;
  /** Real providers without documented idempotency require a Redis send guard. */
  readonly requiresSubmissionGuard?: boolean;
  send(message: SmsMessageInput): Promise<{ providerMessageId: string }>;
}

/**
 * Provider failure that is safe to log and store: it carries only a short
 * code (never the URL, API key, phone or message text).
 */
export class SmsProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`SMS provider error: ${code}`);
    this.name = 'SmsProviderError';
  }
}
