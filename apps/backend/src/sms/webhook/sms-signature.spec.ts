import { createHmac } from 'node:crypto';
import { checkWebhookSignature, signWebhook } from './sms-signature.js';

const SECRET = 'webhook-secret-0123456789abcdef0123456789';
const body = Buffer.from('{"messageId":"m-1","status":"DELIVERED"}');
const now = 1_800_000_000;

function check(
  overrides: Partial<Parameters<typeof checkWebhookSignature>[0]>,
) {
  const timestamp = String(now);
  return checkWebhookSignature({
    secret: SECRET,
    timestamp,
    signature: signWebhook(SECRET, timestamp, body),
    rawBody: body,
    nowSeconds: now,
    ...overrides,
  });
}

describe('webhook signature', () => {
  it('accepts a correct signature (case-insensitive hex)', () => {
    expect(check({})).toBe('ok');
    expect(
      check({
        signature: signWebhook(SECRET, String(now), body)
          .toUpperCase()
          .replace('SHA256=', 'sha256='),
      }),
    ).toBe('ok');
  });

  it('signs `${timestamp}.${rawBody}` with HMAC-SHA256', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`${now}.${body.toString('utf8')}`)
      .digest('hex');
    expect(signWebhook(SECRET, String(now), body)).toBe(`sha256=${expected}`);
  });

  it('rejects a tampered body, another secret or another timestamp', () => {
    expect(
      check({
        rawBody: Buffer.from('{"messageId":"m-2","status":"DELIVERED"}'),
      }),
    ).toBe('invalid');
    expect(
      check({
        signature: signWebhook(
          'other-secret-0123456789abcdef012345',
          String(now),
          body,
        ),
      }),
    ).toBe('invalid');
    expect(check({ timestamp: String(now - 1) })).toBe('invalid');
  });

  it('rejects timestamps outside ±300 s', () => {
    const old = String(now - 301);
    expect(
      check({ timestamp: old, signature: signWebhook(SECRET, old, body) }),
    ).toBe('stale');
    const future = String(now + 301);
    expect(
      check({
        timestamp: future,
        signature: signWebhook(SECRET, future, body),
      }),
    ).toBe('stale');
    const edge = String(now - 300);
    expect(
      check({ timestamp: edge, signature: signWebhook(SECRET, edge, body) }),
    ).toBe('ok');
  });

  it.each([
    ['missing timestamp', { timestamp: undefined }],
    ['non-numeric timestamp', { timestamp: '17e8' }],
    ['header arrays', { timestamp: [String(now)] }],
    ['missing signature', { signature: undefined }],
    ['signature without prefix', { signature: 'a'.repeat(64) }],
    ['short signature', { signature: 'sha256=abc' }],
    ['missing raw body', { rawBody: undefined }],
  ])('treats %s as malformed', (_name, overrides) => {
    expect(check(overrides)).toBe('malformed');
  });
});
