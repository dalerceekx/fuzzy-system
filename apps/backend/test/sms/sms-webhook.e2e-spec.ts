import { randomUUID } from 'node:crypto';
import { SmsService } from '../../src/sms/sms.service.js';
import { SmsDeliveryReports } from '../../src/sms/webhook/sms-delivery-reports.js';
import { signWebhook } from '../../src/sms/webhook/sms-signature.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';

const SECRET = 'test-only-sms-webhook-secret-0123456789abcdef';
const PATH = '/api/v1/sms/webhook/delivery';

const nowSeconds = () => String(Math.floor(Date.now() / 1000));

describe('SMS delivery webhook', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['sms'],
      env: { SMS_WEBHOOK_SECRET: SECRET },
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function sentMessage() {
    return testApp.prisma.smsMessage.create({
      data: {
        phoneMasked: '+99899*****01',
        purpose: 'PHONE_VERIFICATION',
        provider: 'mock',
        status: 'SENT',
        attempts: 1,
        sentAt: new Date(),
        providerMessageId: `prov-${randomUUID()}`,
      },
    });
  }

  function post(
    body: string,
    headers: { timestamp?: string; signature?: string; ip?: string } = {},
  ) {
    const timestamp = headers.timestamp ?? nowSeconds();
    const req = testApp
      .http()
      .post(PATH)
      .set('X-Forwarded-For', headers.ip ?? uniqueIp())
      .set('Content-Type', 'application/json')
      .set('X-Sms-Timestamp', timestamp)
      .set(
        'X-Sms-Signature',
        headers.signature ?? signWebhook(SECRET, timestamp, body),
      );
    return req.send(body);
  }

  const status = async (id: string) =>
    (await testApp.prisma.smsMessage.findUniqueOrThrow({ where: { id } }))
      .status;

  it('applies a correctly signed DELIVERED report', async () => {
    const message = await sentMessage();
    const res = await post(
      JSON.stringify({
        messageId: message.providerMessageId,
        status: 'DELIVERED',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ok: true });
    const stored = await testApp.prisma.smsMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(stored.status).toBe('DELIVERED');
    expect(stored.deliveredAt).toBeInstanceOf(Date);
  });

  it('records a FAILED report with the provider error code only', async () => {
    const message = await sentMessage();
    const res = await post(
      JSON.stringify({
        messageId: message.providerMessageId,
        status: 'FAILED',
        errorCode: 'UNDELIVERABLE',
      }),
    );
    expect(res.status).toBe(200);
    expect(
      await testApp.prisma.smsMessage.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ status: 'FAILED', lastError: 'PROVIDER:UNDELIVERABLE' });
  });

  it('rejects a bad signature with 401 and changes nothing', async () => {
    const message = await sentMessage();
    const body = JSON.stringify({
      messageId: message.providerMessageId,
      status: 'DELIVERED',
    });
    const timestamp = nowSeconds();
    for (const signature of [
      signWebhook('wrong-secret-0123456789abcdef0123456789', timestamp, body),
      signWebhook(SECRET, timestamp, body.replace('DELIVERED', 'FAILED')),
      'sha256=' + '0'.repeat(64),
      'garbage',
    ]) {
      const res = await post(body, { timestamp, signature });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'INVALID_SIGNATURE' });
    }
    const missing = await testApp
      .http()
      .post(PATH)
      .set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'application/json')
      .send(body);
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(await status(message.id)).toBe('SENT');
  });

  it('rejects a stale (or future) timestamp even with a valid signature', async () => {
    const message = await sentMessage();
    const body = JSON.stringify({
      messageId: message.providerMessageId,
      status: 'DELIVERED',
    });
    const now = Number(nowSeconds());
    // Well outside ±300 s, so a second ticking over mid-test cannot flake.
    for (const timestamp of [String(now - 310), String(now + 310)]) {
      const res = await post(body, { timestamp });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'INVALID_SIGNATURE' });
    }
    expect(await status(message.id)).toBe('SENT');
  });

  it('rejects a replayed request', async () => {
    const message = await sentMessage();
    const body = JSON.stringify({
      messageId: message.providerMessageId,
      status: 'FAILED',
    });
    const timestamp = nowSeconds();
    const signature = signWebhook(SECRET, timestamp, body);
    expect((await post(body, { timestamp, signature })).status).toBe(200);
    // Reset the row so a processed replay would be visible.
    await testApp.prisma.smsMessage.update({
      where: { id: message.id },
      data: { status: 'SENT', lastError: null },
    });
    const replay = await post(body, { timestamp, signature });
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(await status(message.id)).toBe('SENT');
  });

  it('a report that failed to apply can be retried with the same signature', async () => {
    const message = await sentMessage();
    const body = JSON.stringify({
      messageId: message.providerMessageId,
      status: 'DELIVERED',
    });
    const timestamp = nowSeconds();
    const signature = signWebhook(SECRET, timestamp, body);
    const reports = testApp.app.get(SmsDeliveryReports);
    const spy = vi
      .spyOn(reports, 'apply')
      .mockRejectedValueOnce(new Error('db down'));
    try {
      const failed = await post(body, { timestamp, signature });
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain('db down');
      expect(await status(message.id)).toBe('SENT');
    } finally {
      spy.mockRestore();
    }
    const retried = await post(body, { timestamp, signature });
    expect(retried.status).toBe(200);
    expect(await status(message.id)).toBe('DELIVERED');
    // Once processed, the signature is spent again.
    expect((await post(body, { timestamp, signature })).status).toBe(401);
  });

  it('applies a report that arrives before the worker stored the provider id', async () => {
    const phone = await uniquePhone();
    const providerMessageId = `prov-${randomUUID()}`;
    const early: number[] = [];
    const send = vi
      .spyOn(testApp.sms, 'send')
      .mockImplementationOnce(async () => {
        // The provider reports delivery while the row is still QUEUED
        // without a provider id.
        const res = await post(
          JSON.stringify({ messageId: providerMessageId, status: 'DELIVERED' }),
        );
        early.push(res.status);
        return { providerMessageId };
      });
    try {
      await testApp.app
        .get(SmsService)
        .sendOtp({ phone, code: '135790', purpose: 'PHONE_VERIFICATION' });
    } finally {
      send.mockRestore();
    }
    expect(early).toStrictEqual([200]);
    const stored = await testApp.prisma.smsMessage.findUniqueOrThrow({
      where: { providerMessageId },
    });
    expect(stored.status).toBe('DELIVERED');
    expect(stored.deliveredAt).toBeInstanceOf(Date);
  });

  it('answers unknown message ids exactly like known ones', async () => {
    const res = await post(
      JSON.stringify({
        messageId: `prov-${randomUUID()}`,
        status: 'DELIVERED',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ok: true });
  });

  it('validates the body after the signature (400 for a signed bad body)', async () => {
    const message = await sentMessage();
    const res = await post(
      JSON.stringify({
        messageId: message.providerMessageId,
        status: 'READ',
        extra: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(
      await testApp.prisma.smsMessage.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ status: 'SENT', lastError: null, deliveredAt: null });
  });

  it('does not move a DELIVERED message back to FAILED', async () => {
    const message = await sentMessage();
    const id = message.providerMessageId;
    expect(
      (await post(JSON.stringify({ messageId: id, status: 'DELIVERED' })))
        .status,
    ).toBe(200);
    expect(
      (await post(JSON.stringify({ messageId: id, status: 'FAILED' }))).status,
    ).toBe(200);
    expect(await status(message.id)).toBe('DELIVERED');
  });

  it('is rate limited per IP, also for correctly signed reports', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 120; i += 1) {
      const res = await testApp
        .http()
        .post(PATH)
        .set('X-Forwarded-For', ip)
        .set('Content-Type', 'application/json')
        .send('{}');
      expect(res.status).toBe(401);
    }
    const message = await sentMessage();
    const res = await post(
      JSON.stringify({
        messageId: message.providerMessageId,
        status: 'DELIVERED',
      }),
      { ip },
    );
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await status(message.id)).toBe('SENT');
  });
});

describe('SMS delivery webhook without SMS_WEBHOOK_SECRET', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['sms'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('responds 404 like a route that does not exist, even when signed', async () => {
    const body = JSON.stringify({ messageId: 'm-1', status: 'DELIVERED' });
    const timestamp = nowSeconds();
    const res = await testApp
      .http()
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Sms-Timestamp', timestamp)
      .set('X-Sms-Signature', signWebhook(SECRET, timestamp, body))
      .send(body);
    const missing = await testApp
      .http()
      .post('/api/v1/sms/webhook/does-not-exist')
      .send(body);
    expect(res.status).toBe(404);
    expect(missing.status).toBe(404);
    const strip = (body: Record<string, unknown>) => {
      const { requestId, ...rest } = body;
      expect(typeof requestId).toBe('string');
      return rest;
    };
    expect(strip(res.body as Record<string, unknown>)).toStrictEqual(
      strip(missing.body as Record<string, unknown>),
    );
  });
});
