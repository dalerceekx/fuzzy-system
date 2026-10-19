import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { getRootLogger, serializeError } from '../../logging/logger.js';
import { requestPath } from '../../logging/request-path.js';
import { dbErrorInfo, type DbErrorInfo } from '../../prisma/db-errors.js';
import type { AppRequest } from '../auth/auth-user.js';
import { RequestContext } from '../context/request-context.js';
import { AppException, ErrorMessages } from './app.exception.js';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId: string;
  details?: Record<string, unknown>;
}

type Rendered = Omit<ErrorBody, 'requestId'>;

const STATUS_CODES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: ErrorMessages.badRequest },
  401: { code: 'UNAUTHORIZED', message: ErrorMessages.unauthorized },
  403: { code: 'FORBIDDEN', message: ErrorMessages.forbidden },
  404: { code: 'NOT_FOUND', message: ErrorMessages.notFound },
  405: { code: 'METHOD_NOT_ALLOWED', message: ErrorMessages.methodNotAllowed },
  409: { code: 'CONFLICT', message: ErrorMessages.conflict },
  413: { code: 'PAYLOAD_TOO_LARGE', message: ErrorMessages.payloadTooLarge },
  415: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: ErrorMessages.unsupportedMediaType,
  },
  422: { code: 'UNPROCESSABLE_ENTITY', message: ErrorMessages.unprocessable },
  429: { code: 'RATE_LIMITED', message: ErrorMessages.tooManyRequests },
};

/** Stable code + default message for a client error status. */
function describeStatus(status: number): { code: string; message: string } {
  const known = STATUS_CODES[status];
  if (known) return known;
  const name = (HttpStatus as Record<number, string | undefined>)[status];
  return { code: name ?? 'BAD_REQUEST', message: ErrorMessages.badRequest };
}

// class-validator's whitelist message embeds the client-chosen property name
// (`property <name> should not exist`, possibly behind a nested path).
const UNKNOWN_PROPERTY_MESSAGE = /(^|\.)property .* should not exist$/s;

/**
 * Validation messages come from DTO metadata, except whitelist violations,
 * which would echo attacker-chosen keys: those collapse into one fixed
 * message.
 */
export function safeValidationMessages(messages: string[]): string[] {
  const safe = messages.map((message) =>
    UNKNOWN_PROPERTY_MESSAGE.test(message)
      ? ErrorMessages.unknownField
      : message,
  );
  return [...new Set(safe)].slice(0, 50);
}

const INTERNAL: Rendered = {
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_ERROR',
  message: ErrorMessages.internal,
};

/**
 * The only producer of error responses:
 * `{ statusCode, code, message, requestId, details? }`. Never a stack trace,
 * SQL, constraint detail, file path, env value or secret. Unexpected errors
 * become a generic 500; database errors are mapped by SQLSTATE/Prisma code
 * and logged with codes only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: Logger;

  constructor(private readonly adapterHost: HttpAdapterHost) {
    this.logger = getRootLogger().child({ context: AllExceptionsFilter.name });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const requestId =
      (typeof request?.id === 'string' && request.id) ||
      RequestContext.get()?.requestId ||
      'unknown';

    const rendered = this.render(exception, request, requestId);
    if (response.headersSent) {
      // A streamed response failed midway; the status line is gone already.
      response.destroy();
      return;
    }
    const retryAfter = rendered.details?.retryAfterSeconds;
    if (rendered.statusCode === 429 && typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }
    const body: ErrorBody = { ...rendered, requestId };
    this.adapterHost.httpAdapter.reply(response, body, rendered.statusCode);
  }

  private render(
    exception: unknown,
    request: Request | undefined,
    requestId: string,
  ): Rendered {
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      return this.renderHttpException(exception, request, requestId);
    }

    const db = dbErrorInfo(exception);
    if (db) return this.renderDatabaseError(db, request, requestId);

    // Express/body-parser style errors (http-errors) with a client status.
    const status = clientErrorStatus(exception);
    if (status) {
      const { code, message } = describeStatus(status);
      return { statusCode: status, code, message };
    }

    this.logger.error(
      { reqId: requestId, ...route(request), err: serializeError(exception) },
      'unhandled error',
    );
    return INTERNAL;
  }

  private renderHttpException(
    exception: HttpException,
    request: Request | undefined,
    requestId: string,
  ): Rendered {
    const status = exception.getStatus();
    if (status >= 500) {
      this.logger.error(
        { reqId: requestId, ...route(request), err: serializeError(exception) },
        'server error exception',
      );
      return INTERNAL;
    }
    const known = describeStatus(status);
    const payload = exception.getResponse();
    const message =
      typeof payload === 'object' && payload !== null
        ? (payload as { message?: unknown }).message
        : payload;

    // ValidationPipe: a list of constraint messages built from DTO metadata.
    if (
      status === 400 &&
      Array.isArray(message) &&
      message.every((m) => typeof m === 'string')
    ) {
      return {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: safeValidationMessages(message as string[]),
      };
    }
    // Framework exception messages are never reflected: they can echo
    // client input ("Cannot GET /path", "Failed to decode param '%E0…'",
    // multer's "File too large", pipe messages). Application code that
    // needs a specific message throws AppException (Errors.*).
    return { statusCode: status, code: known.code, message: known.message };
  }

  private renderDatabaseError(
    db: DbErrorInfo,
    request: Request | undefined,
    requestId: string,
  ): Rendered {
    const mapped = mapDatabaseError(db);
    // Codes only: messages/DETAIL of database errors may contain row values.
    const log = { reqId: requestId, ...route(request), db };
    if (mapped.statusCode >= 500) this.logger.error(log, 'database error');
    else this.logger.warn(log, 'database constraint rejected the request');
    return mapped;
  }
}

export function mapDatabaseError(db: DbErrorInfo): Rendered {
  const state = db.sqlState;
  const code = db.prismaCode;
  if (state === '23505' || code === 'P2002') {
    return {
      statusCode: 409,
      code: 'CONFLICT',
      message: ErrorMessages.duplicate,
    };
  }
  if (state === '23503' || code === 'P2003') {
    return {
      statusCode: 409,
      code: 'CONFLICT',
      message: ErrorMessages.conflict,
    };
  }
  if (state === '23514' || state === '42501') {
    return {
      statusCode: 409,
      code: 'CONSTRAINT_VIOLATION',
      message: ErrorMessages.constraint,
    };
  }
  if (state === '40001' || state === '40P01' || code === 'P2034') {
    return { statusCode: 409, code: 'RETRY', message: ErrorMessages.retry };
  }
  if (code === 'P2025') {
    return {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: ErrorMessages.notFound,
    };
  }
  return INTERNAL;
}

function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode, expose } = exception as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' &&
    value >= 400 &&
    value < 500 &&
    expose === true
    ? value
    : undefined;
}

function route(request: Request | undefined): {
  method?: string;
  path?: string;
} {
  return request ? { method: request.method, path: requestPath(request) } : {};
}
