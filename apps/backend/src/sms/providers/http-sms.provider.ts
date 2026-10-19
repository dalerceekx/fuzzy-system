import { randomUUID } from 'node:crypto';
import {
  SmsProviderError,
  type SmsMessageInput,
  type SmsProvider,
} from '../sms.types.js';

export interface HttpSmsProviderOptions {
  apiUrl: string;
  apiKey: string;
  sender?: string;
  /** Exact hostnames the provider may call (SMS_ALLOWED_HOSTS). */
  allowedHosts: readonly string[];
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const PROVIDER_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * POSTs `{ to, text, from? }` as JSON with a Bearer API key. Every error it
 * throws is an SmsProviderError with a fixed code, so nothing secret (API
 * key, phone, OTP text) can reach logs or the database through it.
 */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly requiresSubmissionGuard = true;
  private readonly fetchFn: typeof fetch;
  private readonly allowedHosts: ReadonlySet<string>;

  constructor(private readonly options: HttpSmsProviderOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.allowedHosts = new Set(
      options.allowedHosts.map((host) => host.toLowerCase()),
    );
  }

  async send(message: SmsMessageInput): Promise<{ providerMessageId: string }> {
    // Re-checked on every call (not only at startup) so the request can only
    // ever go to an allowlisted https host.
    const url = this.allowedUrl();

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          to: message.to,
          text: message.text,
          ...(this.options.sender ? { from: this.options.sender } : {}),
        }),
        // A redirect could forward the API key to a host outside the
        // allowlist.
        redirect: 'error',
        signal: AbortSignal.timeout(
          this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new SmsProviderError('TIMEOUT', false);
      }
      throw new SmsProviderError('NETWORK', false);
    }

    if (response.status >= 300 && response.status < 400) {
      await discardBody(response);
      throw new SmsProviderError('REDIRECT', false);
    }
    if (!response.ok) {
      await discardBody(response);
      // 5xx/timeouts can follow acceptance. Only an explicit rate-limit
      // rejection is safe to retry without provider idempotency support.
      const retryable = response.status === 429;
      throw new SmsProviderError(`HTTP_${response.status}`, retryable);
    }
    return { providerMessageId: await readMessageId(response) };
  }

  private allowedUrl(): URL {
    let url: URL;
    try {
      url = new URL(this.options.apiUrl);
    } catch {
      throw new SmsProviderError('INVALID_URL', false);
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      !this.allowedHosts.has(url.hostname.toLowerCase())
    ) {
      throw new SmsProviderError('HOST_NOT_ALLOWED', false);
    }
    return url;
  }
}

/** `id` | `message_id` | `data.id` from the JSON body, else a local id. */
async function readMessageId(response: Response): Promise<string> {
  let body: unknown;
  try {
    const text = await readLimitedText(response);
    body = text === undefined ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const record = isRecord(body) ? body : {};
  const data = isRecord(record.data) ? record.data : {};
  for (const candidate of [record.id, record.message_id, data.id]) {
    const id =
      typeof candidate === 'number' && Number.isSafeInteger(candidate)
        ? String(candidate)
        : candidate;
    if (typeof id === 'string' && PROVIDER_ID.test(id)) return id;
  }
  return `local-${randomUUID()}`;
}

/**
 * The body as UTF-8, or undefined when it exceeds MAX_RESPONSE_BYTES. Reads
 * incrementally and cancels the stream at the cap, so a misbehaving endpoint
 * cannot make the worker buffer an arbitrarily large response.
 */
async function readLimitedText(
  response: Response,
): Promise<string | undefined> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await discardBody(response);
    return undefined;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Releases the connection without reading the body. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
