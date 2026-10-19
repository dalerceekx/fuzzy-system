import {
  SmsProviderError,
  type SmsMessageInput,
  type SmsProvider,
} from '../sms.types.js';

export interface EskizSmsProviderOptions {
  baseUrl: string;
  email: string;
  password: string;
  from: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 16 * 1024;
// Local cache ceiling, further shortened by the token's exp when present.
const TOKEN_CACHE_MS = 29 * 24 * 60 * 60 * 1000;
const EXPIRY_SKEW_MS = 60_000;

/** Eskiz's documented multipart API; never logs credentials, codes or bodies. */
export class EskizSmsProvider implements SmsProvider {
  readonly name = 'eskiz';
  readonly requiresSubmissionGuard = true;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private token?: { value: string; expiresAt: number };
  private authenticating?: Promise<string>;

  constructor(private readonly options: EskizSmsProviderOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async send(message: SmsMessageInput): Promise<{ providerMessageId: string }> {
    this.assertNotExpired(message);
    if (!/^\+998\d{9}$/.test(message.to)) {
      throw new SmsProviderError('ESKIZ_INVALID_PHONE', false);
    }
    let token = await this.accessToken();
    let response = await this.submit(message, token);
    // An explicit 401 rejected the request before acceptance. This is the
    // only SMS submission we retry, once, after renewing authentication.
    if (response.status === 401) {
      await discard(response);
      token = await this.accessToken(token);
      response = await this.submit(message, token);
    }
    if (!response.ok) {
      await discard(response);
      throw new SmsProviderError(`ESKIZ_HTTP_${response.status}`, false);
    }
    const body = await readJson(response);
    if (
      !isRecord(body) ||
      typeof body.id !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(body.id) ||
      body.status !== 'waiting'
    ) {
      // Success without the documented acknowledgement may already have
      // incurred a charge. Do not fabricate a delivery id or submit again.
      throw new SmsProviderError('ESKIZ_INVALID_ACK', false);
    }
    return { providerMessageId: body.id };
  }

  private submit(message: SmsMessageInput, token: string): Promise<Response> {
    // Login/refresh can take time: never submit a code that expired meanwhile.
    this.assertNotExpired(message);
    const body = new FormData();
    body.set('mobile_phone', message.to.slice(1));
    body.set('message', message.text);
    body.set('from', this.options.from);
    return this.request('/message/sms/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  }

  private assertNotExpired(message: SmsMessageInput): void {
    if (
      message.expiresAt !== undefined &&
      (!Number.isFinite(message.expiresAt) || this.now() >= message.expiresAt)
    ) {
      throw new SmsProviderError('OTP_EXPIRED', false);
    }
  }

  private async accessToken(rejectedToken?: string): Promise<string> {
    const cached = this.token;
    if (
      cached &&
      cached.expiresAt > this.now() &&
      cached.value !== rejectedToken
    ) {
      return cached.value;
    }
    if (this.authenticating) return this.authenticating;
    this.authenticating = this.authenticate(cached?.value);
    try {
      return await this.authenticating;
    } finally {
      this.authenticating = undefined;
    }
  }

  private async authenticate(previousToken?: string): Promise<string> {
    this.token = undefined;
    if (previousToken) {
      const response = await this.request('/auth/refresh', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${previousToken}` },
      });
      if (response.ok) return this.saveToken(await readJson(response));
      await discard(response);
      // Only rejected credentials permit a fresh login. Rate limits and
      // outages must not cause an uncontrolled authentication loop.
      if (response.status !== 401 && response.status !== 403) {
        throw new SmsProviderError(`ESKIZ_AUTH_${response.status}`, false);
      }
    }
    const body = new FormData();
    body.set('email', this.options.email);
    body.set('password', this.options.password);
    const response = await this.request('/auth/login', {
      method: 'POST',
      body,
    });
    if (!response.ok) {
      await discard(response);
      throw new SmsProviderError(`ESKIZ_AUTH_${response.status}`, false);
    }
    return this.saveToken(await readJson(response));
  }

  private saveToken(body: unknown): string {
    const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
    if (
      !data ||
      typeof data.token !== 'string' ||
      data.token.length === 0 ||
      data.token.length > 8192 ||
      /[\s\r\n]/.test(data.token)
    ) {
      throw new SmsProviderError('ESKIZ_AUTH_INVALID_RESPONSE', false);
    }
    let expiresAt = this.now() + TOKEN_CACHE_MS;
    // The authenticated HTTPS response is the credential source. Decode
    // exp only as a conservative cache hint, never as authorization proof.
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(data.token.split('.')[1] ?? '', 'base64url').toString(
          'utf8',
        ),
      );
      if (
        isRecord(payload) &&
        typeof payload.exp === 'number' &&
        Number.isFinite(payload.exp)
      ) {
        expiresAt = Math.min(expiresAt, payload.exp * 1000 - EXPIRY_SKEW_MS);
      }
    } catch {
      // Opaque tokens use the local cache ceiling; a 401 forces renewal.
    }
    if (expiresAt <= this.now()) {
      throw new SmsProviderError('ESKIZ_AUTH_EXPIRED_TOKEN', false);
    }
    this.token = { value: data.token, expiresAt };
    return data.token;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let base: URL;
    try {
      base = new URL(this.options.baseUrl);
    } catch {
      throw new SmsProviderError('ESKIZ_INVALID_URL', false);
    }
    if (
      base.protocol !== 'https:' ||
      base.hostname !== 'notify.eskiz.uz' ||
      (base.port !== '' && base.port !== '443') ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname.replace(/\/$/, '') !== '/api'
    ) {
      throw new SmsProviderError('ESKIZ_HOST_NOT_ALLOWED', false);
    }
    try {
      return await this.fetchFn(`${base.href.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (err) {
      const timeout =
        err instanceof Error &&
        ['TimeoutError', 'AbortError'].includes(err.name);
      // The server may have accepted a submission before connectivity failed.
      throw new SmsProviderError(
        timeout ? 'ESKIZ_TIMEOUT' : 'ESKIZ_NETWORK',
        false,
      );
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await discard(response);
    throw new SmsProviderError('ESKIZ_RESPONSE_TOO_LARGE', false);
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SmsProviderError('ESKIZ_RESPONSE_TOO_LARGE', false);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (err) {
    if (err instanceof SmsProviderError) throw err;
    throw new SmsProviderError('ESKIZ_INVALID_RESPONSE', false);
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
