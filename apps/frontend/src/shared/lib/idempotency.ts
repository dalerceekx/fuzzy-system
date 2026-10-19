/**
 * Idempotency-Key for one user submission (backend accepts
 * /^[A-Za-z0-9_-]{8,128}$/). Generate it once per submit attempt and reuse
 * it for any retry of that same attempt, so the server applies it once.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
