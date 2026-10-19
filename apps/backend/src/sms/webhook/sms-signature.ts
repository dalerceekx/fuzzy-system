import { createHmac } from 'node:crypto';
import { safeEqual } from '../../security/crypto.js';

/** Maximum clock difference accepted for `X-Sms-Timestamp`. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^sha256=[0-9a-f]{64}$/;

/** `sha256=<hex>` of HMAC-SHA256(secret, `${timestamp}.${rawBody}`). */
export function signWebhook(
  secret: string,
  timestamp: string,
  rawBody: Buffer | string,
): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.`, 'utf8');
  hmac.update(rawBody);
  return `sha256=${hmac.digest('hex')}`;
}

export type WebhookSignatureCheck = 'ok' | 'malformed' | 'stale' | 'invalid';

/** Checks format, timestamp window and signature (constant-time). */
export function checkWebhookSignature(params: {
  secret: string;
  timestamp: unknown;
  signature: unknown;
  rawBody: Buffer | undefined;
  nowSeconds?: number;
}): WebhookSignatureCheck {
  const { secret, timestamp, signature, rawBody } = params;
  if (
    typeof timestamp !== 'string' ||
    typeof signature !== 'string' ||
    !TIMESTAMP.test(timestamp) ||
    !SIGNATURE.test(signature.toLowerCase()) ||
    !Buffer.isBuffer(rawBody)
  ) {
    return 'malformed';
  }
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return 'stale';
  }
  return safeEqual(
    signature.toLowerCase(),
    signWebhook(secret, timestamp, rawBody),
  )
    ? 'ok'
    : 'invalid';
}
