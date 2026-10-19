import { SmsProviderError } from '../sms.types.js';
import {
  EskizSmsProvider,
  type EskizSmsProviderOptions,
} from './eskiz-sms.provider.js';

const EMAIL = 'eskiz-account@example.test';
const PASSWORD = 'test-private-password';
const TOKEN = 'private-provider-token';
const MESSAGE = {
  to: '+998901234567',
  text: 'RIIZQ: Tasdiqlash kodingiz: 482915. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.',
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const accepted = () =>
  response({
    id: '59bf10a2-aba8-4694-8fd5-0be20102a580',
    status: 'waiting',
    message: 'Waiting for SMS provider',
  });
const authenticated = (token = TOKEN) =>
  response({
    message: 'token_generated',
    data: { token },
    token_type: 'bearer',
  });

function setup(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
  options: Partial<EskizSmsProviderOptions> = {},
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) =>
    handler(url, init),
  );
  const provider = new EskizSmsProvider({
    baseUrl: 'https://notify.eskiz.uz/api',
    email: EMAIL,
    password: PASSWORD,
    from: '4546',
    fetch: fetchMock as unknown as typeof fetch,
    ...options,
  });
  return { provider, fetchMock };
}

async function failure(promise: Promise<unknown>): Promise<SmsProviderError> {
  const error: unknown = await promise.catch((err: unknown) => err);
  expect(error).toBeInstanceOf(SmsProviderError);
  const serialized = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
  for (const secret of [EMAIL, PASSWORD, TOKEN, '482915', MESSAGE.to])
    expect(serialized).not.toContain(secret);
  expect(error).toMatchObject({ retryable: false });
  return error as SmsProviderError;
}

describe('EskizSmsProvider', () => {
  it('uses the documented multipart login/send contract and caches a private token', async () => {
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login') ? authenticated() : accepted(),
    );
    expect(await provider.send(MESSAGE)).toEqual({
      providerMessageId: '59bf10a2-aba8-4694-8fd5-0be20102a580',
    });
    await provider.send(MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [loginUrl, login] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe('https://notify.eskiz.uz/api/auth/login');
    expect(login.method).toBe('POST');
    expect(Object.fromEntries((login.body as FormData).entries())).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
    const [sendUrl, send] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe('https://notify.eskiz.uz/api/message/sms/send');
    expect(send.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(send.redirect).toBe('error');
    expect(send.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries((send.body as FormData).entries())).toEqual({
      mobile_phone: MESSAGE.to.slice(1),
      message: MESSAGE.text,
      from: '4546',
    });
  });

  it('authenticates once for concurrent sends', async () => {
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login') ? authenticated() : accepted(),
    );
    await Promise.all(Array.from({ length: 8 }, () => provider.send(MESSAGE)));
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/login')),
    ).toHaveLength(1);
  });

  it('refreshes an expired cached token with PATCH and Bearer authorization', async () => {
    let now = 1_800_000_000_000;
    const jwt = `header.${Buffer.from(JSON.stringify({ exp: now / 1000 + 120 })).toString('base64url')}.signature`;
    const { provider, fetchMock } = setup(
      (url) =>
        url.endsWith('/login')
          ? authenticated(jwt)
          : url.endsWith('/refresh')
            ? authenticated('renewed-token')
            : accepted(),
      { now: () => now },
    );
    await provider.send(MESSAGE);
    now += 65_000;
    await provider.send(MESSAGE);
    const refresh = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/refresh'),
    )?.[1];
    expect(refresh).toMatchObject({
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(fetchMock.mock.calls.at(-1)?.[1].headers).toMatchObject({
      Authorization: 'Bearer renewed-token',
    });
  });

  it('retries an explicit send 401 once after refresh', async () => {
    let sends = 0;
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login')
        ? authenticated()
        : url.endsWith('/refresh')
          ? authenticated('renewed-token')
          : ++sends === 1
            ? response({}, 401)
            : accepted(),
    );
    await provider.send(MESSAGE);
    expect(sends).toBe(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh')),
    ).toHaveLength(1);
  });

  it('reauthenticates when refresh explicitly rejects the expired token', async () => {
    let sends = 0;
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login')
        ? authenticated()
        : url.endsWith('/refresh')
          ? response({}, 401)
          : ++sends === 1
            ? response({}, 401)
            : accepted(),
    );
    await provider.send(MESSAGE);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/login')),
    ).toHaveLength(2);
    expect(sends).toBe(2);
  });

  it('stops after a second rejected send without an authentication loop', async () => {
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login') || url.endsWith('/refresh')
        ? authenticated()
        : response({ secret: PASSWORD }, 401),
    );
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_HTTP_401',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not send SMS after login authorization failure', async () => {
    const { provider, fetchMock } = setup(() =>
      response({ error: `${EMAIL} ${PASSWORD}` }, 401),
    );
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_AUTH_401',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 500, 503])(
    'does not retry ambiguous or rejected HTTP %i submissions',
    async (status) => {
      const { provider, fetchMock } = setup((url) =>
        url.endsWith('/login')
          ? authenticated()
          : response({ error: `${MESSAGE.text} ${PASSWORD}` }, status),
      );
      expect(await failure(provider.send(MESSAGE))).toMatchObject({
        code: `ESKIZ_HTTP_${status}`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('times out a submitted SMS without retrying it', async () => {
    const { provider, fetchMock } = setup(
      (url, init) =>
        url.endsWith('/login')
          ? authenticated()
          : new Promise((_resolve, reject) =>
              init.signal?.addEventListener('abort', () =>
                reject(init.signal?.reason),
              ),
            ),
      { timeoutMs: 10 },
    );
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_TIMEOUT',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sanitizes network failures without retaining credential-bearing causes', async () => {
    const { provider, fetchMock } = setup((url) => {
      if (url.endsWith('/login')) return authenticated();
      throw new Error(`${PASSWORD} ${TOKEN} ${MESSAGE.text}`);
    });
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_NETWORK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 'valid', status: 'delivered' },
    { status: 'waiting' },
    { id: '', status: 'waiting' },
    { success: true },
  ])('requires the documented acceptance response %j', async (body) => {
    const { provider, fetchMock } = setup((url) =>
      url.endsWith('/login') ? authenticated() : response(body),
    );
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_INVALID_ACK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed token response before submission', async () => {
    const { provider, fetchMock } = setup(() => response({ data: {} }));
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_AUTH_INVALID_RESPONSE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects tokens already expired at authentication', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
    const { provider, fetchMock } = setup(() => authenticated(token));
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_AUTH_EXPIRED_TOKEN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate or submit an already expired OTP', async () => {
    const { provider, fetchMock } = setup(() => authenticated());
    expect(
      await failure(provider.send({ ...MESSAGE, expiresAt: Date.now() - 1 })),
    ).toMatchObject({ code: 'OTP_EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not submit an OTP that expired while authenticating', async () => {
    let now = 1_800_000_000_000;
    const { provider, fetchMock } = setup(
      () => {
        now += 2000;
        return authenticated();
      },
      { now: () => now },
    );
    expect(
      await failure(provider.send({ ...MESSAGE, expiresAt: now + 1000 })),
    ).toMatchObject({ code: 'OTP_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/login$/);
  });

  it('does not retry a rejected submission after the OTP expires during refresh', async () => {
    let now = 1_800_000_000_000;
    const { provider, fetchMock } = setup(
      (url) => {
        if (url.endsWith('/login')) return authenticated();
        if (url.endsWith('/refresh')) {
          now += 2000;
          return authenticated('renewed-token');
        }
        return response({}, 401);
      },
      { now: () => now },
    );
    expect(
      await failure(provider.send({ ...MESSAGE, expiresAt: now + 1000 })),
    ).toMatchObject({ code: 'OTP_EXPIRED' });
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/send')),
    ).toHaveLength(1);
  });

  it('bounds provider response bodies', async () => {
    const { provider } = setup(() =>
      response({ data: { token: 't'.repeat(20_000) } }),
    );
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_RESPONSE_TOO_LARGE',
    });
  });

  it.each([
    'http://notify.eskiz.uz/api',
    'https://notify.eskiz.uz.evil.test/api',
    'https://user:secret@notify.eskiz.uz/api',
    'https://notify.eskiz.uz/api?extra=1',
  ])('refuses an unsafe endpoint %s', async (baseUrl) => {
    const { provider, fetchMock } = setup(() => accepted(), { baseUrl });
    expect(await failure(provider.send(MESSAGE))).toMatchObject({
      code: 'ESKIZ_HOST_NOT_ALLOWED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['998901234567', '+19012345678', '+998123', '+9989012345670'])(
    'refuses invalid Uzbekistan E.164 phone %s',
    async (to) => {
      const { provider, fetchMock } = setup(() => accepted());
      expect(await failure(provider.send({ ...MESSAGE, to }))).toMatchObject({
        code: 'ESKIZ_INVALID_PHONE',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
