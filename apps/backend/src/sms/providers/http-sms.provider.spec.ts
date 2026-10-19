import { SmsProviderError } from '../sms.types.js';
import {
  HttpSmsProvider,
  type HttpSmsProviderOptions,
} from './http-sms.provider.js';

const API_KEY = 'sk-test-very-secret-api-key-123';
const MESSAGE = {
  to: '+998901234567',
  text: 'Mening Fermam: tasdiqlash kodi 482915. Kodni hech kimga bermang.',
};

function provider(
  fetchImpl: (url: URL, init: RequestInit) => Promise<Response>,
  overrides: Partial<HttpSmsProviderOptions> = {},
) {
  const fetchMock = vi.fn(fetchImpl);
  const instance = new HttpSmsProvider({
    apiUrl: 'https://sms.example.uz/v1/send',
    apiKey: API_KEY,
    sender: 'MeningFerm',
    allowedHosts: ['sms.example.uz'],
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
  return { instance, fetchMock };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

/** The rejection, plus proof that no secret leaked into it. */
async function failure(promise: Promise<unknown>): Promise<SmsProviderError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
  expect(err).toBeInstanceOf(SmsProviderError);
  const serialized = `${String(err)} ${(err as Error).stack} ${JSON.stringify(err)}`;
  for (const secret of [API_KEY, '482915', MESSAGE.to, 'sms.example.uz']) {
    expect(serialized).not.toContain(secret);
  }
  return err as SmsProviderError;
}

describe('HttpSmsProvider', () => {
  it('POSTs JSON with the bearer key, redirect: error and a timeout signal', async () => {
    const { instance, fetchMock } = provider(() => json({ id: 'abc-123' }));

    await expect(instance.send(MESSAGE)).resolves.toStrictEqual({
      providerMessageId: 'abc-123',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://sms.example.uz/v1/send');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toStrictEqual({
      to: MESSAGE.to,
      text: MESSAGE.text,
      from: 'MeningFerm',
    });
  });

  it.each([
    [{ message_id: 'm-1' }, 'm-1'],
    [{ data: { id: 42 } }, '42'],
  ])('reads the provider id from %j', async (body, expected) => {
    const { instance } = provider(() => json(body));
    await expect(instance.send(MESSAGE)).resolves.toStrictEqual({
      providerMessageId: expected,
    });
  });

  it('generates an id when the response has no usable one', async () => {
    const { instance } = provider(() =>
      Promise.resolve(new Response('OK', { status: 200 })),
    );
    const { providerMessageId } = await instance.send(MESSAGE);
    expect(providerMessageId).toMatch(/^local-[0-9a-f-]{36}$/);
  });

  it('stops reading an oversized streamed body at 16 KiB and cancels it', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(' '.repeat(4096));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { instance } = provider(() =>
      Promise.resolve(new Response(endless, { status: 200 })),
    );
    const { providerMessageId } = await instance.send(MESSAGE);
    expect(providerMessageId).toMatch(/^local-/);
    expect(cancelled).toBe(true);
    // 16 KiB cap / 4 KiB chunks: never much more than five chunks are pulled.
    expect(pulled).toBeLessThanOrEqual(6);
  });

  it('does not read a body whose Content-Length exceeds the cap', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode('{"id":"too-big"}'));
        controller.close();
      },
    });
    const { instance } = provider(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'Content-Length': String(1024 * 1024) },
        }),
      ),
    );
    const { providerMessageId } = await instance.send(MESSAGE);
    expect(providerMessageId).toMatch(/^local-/);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('counts the cap in bytes, not UTF-16 code units', async () => {
    // 6000 three-byte characters: 18000 bytes but only 6000 code units.
    const text = JSON.stringify({ id: 'ok-1', pad: '☃'.repeat(6000) });
    const { instance } = provider(() =>
      Promise.resolve(new Response(text, { status: 200 })),
    );
    const { providerMessageId } = await instance.send(MESSAGE);
    expect(providerMessageId).toMatch(/^local-/);
  });

  it.each([
    ['a host outside the allowlist', 'https://evil.example.com/send'],
    ['a look-alike host', 'https://sms.example.uz.evil.com/send'],
    ['plain http', 'http://sms.example.uz/send'],
    ['credentials in the URL', 'https://user:pass@sms.example.uz/send'],
  ])('refuses %s without calling fetch', async (_name, apiUrl) => {
    const { instance, fetchMock } = provider(() => json({ id: 'x' }), {
      apiUrl,
    });
    const err = await failure(instance.send(MESSAGE));
    expect(err).toMatchObject({ code: 'HOST_NOT_ALLOWED', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects redirects (fetch with redirect: error throws)', async () => {
    const { instance } = provider((_url, init) =>
      init.redirect === 'error'
        ? Promise.reject(new TypeError('fetch failed: unexpected redirect'))
        : json({ id: 'followed' }),
    );
    const err = await failure(instance.send(MESSAGE));
    expect(err.code).toBe('NETWORK');
  });

  it('never accepts a 3xx response as success', async () => {
    const { instance } = provider(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example.com/' },
        }),
      ),
    );
    const err = await failure(instance.send(MESSAGE));
    expect(err).toMatchObject({ code: 'REDIRECT', retryable: false });
  });

  it('times out slow providers', async () => {
    const { instance } = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason as Error),
          );
        }),
      { timeoutMs: 20 },
    );
    const err = await failure(instance.send(MESSAGE));
    expect(err).toMatchObject({ code: 'TIMEOUT', retryable: false });
  });

  it('maps HTTP errors to retryable / permanent codes without leaking the body', async () => {
    const echo = { error: `bad key ${API_KEY} for ${MESSAGE.to}` };
    const server = await failure(
      provider(() => json(echo, 503)).instance.send(MESSAGE),
    );
    expect(server).toMatchObject({ code: 'HTTP_503', retryable: false });
    const limited = await failure(
      provider(() => json(echo, 429)).instance.send(MESSAGE),
    );
    expect(limited).toMatchObject({ code: 'HTTP_429', retryable: true });
    const auth = await failure(
      provider(() => json(echo, 401)).instance.send(MESSAGE),
    );
    expect(auth).toMatchObject({ code: 'HTTP_401', retryable: false });
  });

  it('does not leak the API key when fetch itself throws with it', async () => {
    const { instance } = provider(() =>
      Promise.reject(
        new Error(`connect failed Authorization: Bearer ${API_KEY}`),
      ),
    );
    const err = await failure(instance.send(MESSAGE));
    expect(err.code).toBe('NETWORK');
  });
});
