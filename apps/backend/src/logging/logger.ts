import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger, type LoggerOptions } from 'pino';
import {
  LOG_SANITIZE_OPTIONS,
  redactSecretsInText,
  sanitizeValue,
} from '../audit/audit-sanitize.js';
import { truncate } from '../common/strings.js';
import { dbErrorInfo, isDatabaseError } from '../prisma/db-errors.js';
import { logDestination } from './log-destination.js';
import { requestPath } from './request-path.js';

export const REDACT_CENSOR = '[REDACTED]';

// Static paths only matter where the logMethod hook cannot run (child
// logger bindings); the hook applies SENSITIVE_KEY_PATTERN at any depth.
const SENSITIVE_LOG_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'mfaToken',
  'sessionToken',
  'jwt',
  'code',
  'otp',
  'otpCode',
  'otpauthUrl',
  'secret',
  'mfaSecret',
  'mfaCode',
  'apiKey',
  'smsApiKey',
  'privateKey',
  'pepper',
  'credentials',
  'authorization',
  'cookie',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_LOG_KEYS.flatMap((key) => [
    key,
    `*.${key}`,
    `*.*.${key}`,
    `*.*.*.${key}`,
  ]),
];

/**
 * Errors are reduced to name/message/stack. Prisma and driver-adapter errors
 * keep only their codes: their messages and `meta` can contain whole rows
 * (Postgres DETAIL includes values such as password hashes).
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  if (isDatabaseError(err)) return { type: err.name, ...dbErrorInfo(err) };
  return {
    type: err.name,
    message: truncate(redactSecretsInText(err.message), 1000),
    ...(err.stack
      ? { stack: truncate(redactSecretsInText(err.stack), 8000) }
      : {}),
  };
}

const LOG_ARGUMENT_OPTIONS = { ...LOG_SANITIZE_OPTIONS, serializeError };

function sanitizeLogArgument(value: unknown, index: number): unknown {
  // A leading Error becomes the merge object; later ones are format args.
  if (value instanceof Error) {
    return index === 0 ? { err: serializeError(value) } : serializeError(value);
  }
  return sanitizeValue(value, LOG_ARGUMENT_OPTIONS);
}

export function createLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: 'meningfermam-api', pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    // pino-http binds raw req/res objects to child loggers; these keep only
    // safe fields (no headers, no bodies) before redaction ever runs.
    serializers: {
      err: serializeError,
      req: (req: IncomingMessage) => ({
        method: req.method,
        path: requestPath(req),
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    hooks: {
      // Safety net on every log call: sensitive keys are redacted at any
      // depth (class instances included), JWT/Bearer values are redacted in
      // any string (messages and format arguments too), and errors are
      // summarized before pino serializes anything.
      logMethod(args, method) {
        const list = args as unknown[];
        for (let i = 0; i < list.length; i += 1) {
          list[i] = sanitizeLogArgument(list[i], i);
        }
        return method.apply(this, args);
      },
    },
  };
}

let rootLogger: Logger | undefined;

/**
 * Process-wide root logger (nestjs-pino also keeps a single instance).
 * JSON lines go through `logDestination`; pretty output is for local
 * development only.
 */
export function getRootLogger(
  options: { level?: string; pretty?: boolean } = {},
): Logger {
  if (!rootLogger) {
    const loggerOptions = createLoggerOptions(options.level ?? 'info');
    rootLogger = options.pretty
      ? pino(
          loggerOptions,
          pino.transport({
            target: 'pino-pretty',
            options: { singleLine: true },
          }),
        )
      : pino(loggerOptions, logDestination);
  }
  return rootLogger;
}
