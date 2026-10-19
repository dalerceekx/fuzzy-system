/**
 * Classification of database errors without ever touching their messages.
 *
 * Observed shapes (Prisma 7 + @prisma/adapter-pg):
 * - model/raw queries: PrismaClientKnownRequestError (P2002 unique, P2003 FK,
 *   P2025 not found, P2034 write conflict, P2039 "database error" for check
 *   violations and trigger-raised errors, P2010 for every raw-query error)
 *   with `meta.driverAdapterError.cause.originalCode` = SQLSTATE;
 * - a deferred constraint trigger failing at COMMIT of an interactive
 *   transaction: a bare `DriverAdapterError` with `cause.originalCode`.
 *
 * `cause.detail`, `originalMessage` and the error message can contain whole
 * rows (Postgres "Failing row contains (…)" includes password hashes), so
 * nothing but the codes and the constraint name may leave this module.
 */

export interface DbErrorInfo {
  prismaCode?: string;
  sqlState?: string;
  constraint?: string;
  model?: string;
}

interface AdapterCause {
  originalCode?: unknown;
  originalMessage?: unknown;
  kind?: unknown;
  constraint?: unknown;
}

const PRISMA_ERROR_NAMES = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
]);

const SQLSTATE = /^[0-9A-Z]{5}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True for any error raised by Prisma or its driver adapter. */
export function isDatabaseError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  const name = typeof err.name === 'string' ? err.name : '';
  return PRISMA_ERROR_NAMES.has(name) || name === 'DriverAdapterError';
}

export function dbErrorInfo(err: unknown): DbErrorInfo | null {
  if (!isRecord(err)) return null;
  const name = typeof err.name === 'string' ? err.name : '';

  if (name === 'DriverAdapterError') {
    return fromCause(err.cause, {});
  }

  if (PRISMA_ERROR_NAMES.has(name)) {
    const info: DbErrorInfo = {};
    if (typeof err.code === 'string') info.prismaCode = err.code;
    const meta = isRecord(err.meta) ? err.meta : undefined;
    if (meta && typeof meta.modelName === 'string') info.model = meta.modelName;
    const adapterError =
      meta && isRecord(meta.driverAdapterError)
        ? meta.driverAdapterError
        : undefined;
    return fromCause(adapterError?.cause, info);
  }

  // A raw node-postgres DatabaseError (code + severity).
  if (
    typeof err.code === 'string' &&
    SQLSTATE.test(err.code) &&
    typeof err.severity === 'string'
  ) {
    const info: DbErrorInfo = { sqlState: err.code };
    if (typeof err.constraint === 'string') info.constraint = err.constraint;
    return info;
  }
  return null;
}

function fromCause(cause: unknown, info: DbErrorInfo): DbErrorInfo {
  if (!isRecord(cause)) return info;
  const adapterCause = cause as AdapterCause;
  if (
    typeof adapterCause.originalCode === 'string' &&
    SQLSTATE.test(adapterCause.originalCode)
  ) {
    info.sqlState = adapterCause.originalCode;
  }
  const constraint = constraintName(adapterCause);
  if (constraint) info.constraint = constraint;
  return info;
}

function constraintName(cause: AdapterCause): string | undefined {
  if (isRecord(cause.constraint)) {
    const { index, fields } = cause.constraint;
    if (typeof index === 'string') return index;
    if (Array.isArray(fields)) return fields.map(String).join(',');
  }
  // Check violations only carry the name inside the message; extract the
  // quoted identifier and nothing else.
  if (typeof cause.originalMessage === 'string') {
    const match =
      /violates (?:check|exclusion) constraint "([^"]{1,128})"/.exec(
        cause.originalMessage,
      );
    if (match) return match[1];
  }
  return undefined;
}

function matches(
  err: unknown,
  sqlStates: readonly string[],
  prismaCodes: readonly string[],
  constraint?: string,
): boolean {
  const info = dbErrorInfo(err);
  if (!info) return false;
  const codeMatches =
    (info.sqlState !== undefined && sqlStates.includes(info.sqlState)) ||
    (info.prismaCode !== undefined && prismaCodes.includes(info.prismaCode));
  return (
    codeMatches && (constraint === undefined || info.constraint === constraint)
  );
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return matches(err, ['23505'], ['P2002'], constraint);
}

export function isForeignKeyViolation(
  err: unknown,
  constraint?: string,
): boolean {
  return matches(err, ['23503'], ['P2003'], constraint);
}

export function isCheckViolation(err: unknown, constraint?: string): boolean {
  return matches(err, ['23514'], [], constraint);
}

export function isNotFoundError(err: unknown): boolean {
  return matches(err, [], ['P2025']);
}

/** Serialization failure / deadlock: the transaction may be retried. */
export function isSerializationFailure(err: unknown): boolean {
  return matches(err, ['40001', '40P01'], ['P2034']);
}
