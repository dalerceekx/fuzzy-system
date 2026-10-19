import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Accepts an inbound id only when the request arrived through a trusted
 * proxy (TRUST_PROXY) and the id is short and made of safe characters (it
 * ends up in logs and audit rows); otherwise a new UUID v4. A direct client
 * can therefore never choose or replay the request id stored on its audit
 * rows — the proxy is expected to set/overwrite X-Request-Id itself.
 */
export function resolveRequestId(
  header: unknown,
  fromTrustedProxy: boolean,
): string {
  if (
    fromTrustedProxy &&
    typeof header === 'string' &&
    REQUEST_ID_PATTERN.test(header)
  ) {
    return header;
  }
  return randomUUID();
}
