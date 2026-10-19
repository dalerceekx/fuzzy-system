import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { AppRequest } from '../common/auth/auth-user.js';
import { getRootLogger } from './logger.js';
import { isHealthRequest, requestPath } from './request-path.js';

export { isHealthRequest, requestPath } from './request-path.js';

function summary(
  req: IncomingMessage,
  res: ServerResponse,
  value: { responseTime?: number },
) {
  return {
    method: req.method,
    path: requestPath(req),
    statusCode: res.statusCode,
    responseTime: value.responseTime,
  };
}

function levelFor(statusCode: number, err?: Error): 'info' | 'warn' | 'error' {
  if (err || statusCode >= 500) return 'error';
  return statusCode >= 400 ? 'warn' : 'info';
}

/**
 * One JSON line per request: reqId, method, path, statusCode, responseTime
 * and userId when authenticated — no headers, no bodies, no query strings.
 * Mounted before any other middleware so that requests rejected early
 * (body too large, plain HTTP, …) are logged as well.
 */
export function createHttpLogger(): RequestHandler {
  const middleware = pinoHttp({
    logger: getRootLogger(),
    wrapSerializers: false,
    quietReqLogger: true,
    quietResLogger: true,
    genReqId: (req) => (req as AppRequest).id,
    autoLogging: { ignore: isHealthRequest },
    customLogLevel: (_req, res, err) => levelFor(res.statusCode, err),
    customProps: (req) => {
      const userId = (req as AppRequest).user?.id;
      return userId ? { userId } : {};
    },
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    customSuccessObject: (req, res, value: { responseTime?: number }) =>
      summary(req, res, value),
    customErrorObject: (req, res, _err, value: { responseTime?: number }) =>
      summary(req, res, value),
  });
  return middleware as unknown as RequestHandler;
}
