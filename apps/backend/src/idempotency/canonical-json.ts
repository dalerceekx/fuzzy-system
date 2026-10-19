import { Prisma } from '../generated/prisma/client.js';
import { sha256Hex } from '../security/crypto.js';

/**
 * Deterministic JSON: object keys sorted recursively, undefined dropped,
 * Decimal/bigint → string, Date → ISO string. Two requests with the same
 * meaning always produce the same string (and hash).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? 'null';
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol'
      ? null
      : value;
  }
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = normalize(child);
  }
  return sorted;
}
