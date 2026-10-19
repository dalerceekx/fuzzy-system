import { IncomingMessage, ServerResponse } from 'node:http';
import { Prisma } from '../generated/prisma/client.js';

/** Keys whose values are never stored in audit rows or logs. */
export const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|otp|pepper|hash|mfa(secret|code)?|jwt|bearer|signature|credential|^code$|^pin(code)?$)/i;

export const REDACTED = '[REDACTED]';

// Secrets recognisable by shape, wherever they appear (any key, inside
// messages): compact JWS/JWT (`eyJ…` header) and `Bearer <credential>`.
const JWT_IN_TEXT = /eyJ[\w-]{2,}\.[\w-]{2,}\.[\w-]*/g;
const BEARER_IN_TEXT = /\bBearer\s+[\w.~+/-]+=*/gi;

/** Replaces JWT-shaped substrings and Bearer credentials with '[REDACTED]'. */
export function redactSecretsInText(text: string): string {
  return text
    .replace(BEARER_IN_TEXT, `Bearer ${REDACTED}`)
    .replace(JWT_IN_TEXT, REDACTED);
}

export interface SanitizeOptions {
  maxDepth: number;
  maxArrayLength: number;
  maxStringLength: number;
  /**
   * Objects returned as-is instead of being walked. Logging keeps only the
   * raw Node req/res here: pino serializers reduce those to safe fields.
   * Every other object (plain or class instance, e.g. DTOs) is walked.
   */
  preserve?: (object: object) => boolean;
  /** How errors are represented (default: `{ name }` only). */
  serializeError?: (err: Error) => unknown;
}

export const AUDIT_SANITIZE_OPTIONS: SanitizeOptions = {
  maxDepth: 5,
  maxArrayLength: 50,
  maxStringLength: 500,
};

export const LOG_SANITIZE_OPTIONS: SanitizeOptions = {
  maxDepth: 6,
  maxArrayLength: 100,
  maxStringLength: 4096,
  preserve: (object) =>
    object instanceof IncomingMessage || object instanceof ServerResponse,
};

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** `toJSON()` of a class instance (URL, …), or the object itself. */
function jsonView(object: object): unknown {
  const toJSON = (object as { toJSON?: unknown }).toJSON;
  if (isPlainObject(object) || typeof toJSON !== 'function') return object;
  try {
    return (toJSON as () => unknown).call(object);
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

/**
 * Recursively replaces values of sensitive keys with '[REDACTED]' and caps
 * depth, array length and string length. Decimal → string, Date → ISO
 * string, bigint → string; functions and symbols are dropped; JWT-shaped
 * strings and Bearer credentials are redacted by value. Callers must
 * still never pass secrets on purpose — this is a safety net.
 */
export function sanitizeValue(
  value: unknown,
  options: SanitizeOptions = AUDIT_SANITIZE_OPTIONS,
): unknown {
  return walk(value, options, 0, new WeakSet());
}

function walk(
  value: unknown,
  options: SanitizeOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  switch (typeof value) {
    case 'string': {
      const text = redactSecretsInText(value);
      return text.length > options.maxStringLength
        ? `${text.slice(0, options.maxStringLength)}…`
        : text;
    }
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value === null) return null;
  const object = value as object;

  if (Prisma.Decimal.isDecimal(object)) return object.toString();
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? null : object.toISOString();
  }
  if (Buffer.isBuffer(object) || ArrayBuffer.isView(object)) return '[BINARY]';
  if (object instanceof Error) {
    return options.serializeError
      ? options.serializeError(object)
      : { name: object.name };
  }
  if (seen.has(object)) return '[CIRCULAR]';
  if (depth >= options.maxDepth) return '[MAX_DEPTH]';

  if (Array.isArray(object)) {
    seen.add(object);
    const items = object
      .slice(0, options.maxArrayLength)
      .map((item) => walk(item, options, depth + 1, seen));
    seen.delete(object);
    return items.map((item) => (item === undefined ? null : item));
  }
  if (object instanceof Set) {
    return walk([...object], options, depth, seen);
  }
  if (object instanceof Map) {
    return walk(Object.fromEntries(object), options, depth, seen);
  }
  if (options.preserve?.(object)) return object;

  const view = jsonView(object);
  if (view !== object) return walk(view, options, depth + 1, seen);

  // Plain objects and class instances alike (DTOs, result classes): own
  // enumerable properties only, every key checked against the pattern.
  seen.add(object);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    const sanitized = walk(child, options, depth + 1, seen);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  seen.delete(object);
  return result;
}

/** Sanitized, JSON-safe value for an audit column (undefined → SQL NULL). */
export function sanitizeAuditValue(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const sanitized = sanitizeValue(value, AUDIT_SANITIZE_OPTIONS);
  if (sanitized === undefined || sanitized === null) return undefined;
  return sanitized as Prisma.InputJsonValue;
}
