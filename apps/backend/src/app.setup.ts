import type { Server } from 'node:http';
import { isIP } from 'node:net';
import {
  Logger,
  ValidationPipe,
  type NestApplicationOptions,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import type { AppRequest } from './common/auth/auth-user.js';
import { normalizeIp } from './common/context/client-ip.js';
import { RequestContext } from './common/context/request-context.js';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from './common/context/request-id.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import {
  AppException,
  ErrorMessages,
  Errors,
} from './common/errors/app.exception.js';
import { truncateOptional } from './common/strings.js';
import type { Env } from './config/env.js';
import { createHttpLogger, isHealthRequest } from './logging/http-logger.js';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'docs';

/** Swagger UI, its assets and the /docs-json|yaml documents. */
function isDocsPath(path: string): boolean {
  const docs = `/${SWAGGER_PATH}`;
  return (
    path === docs || path.startsWith(`${docs}/`) || path.startsWith(`${docs}-`)
  );
}

/** NestFactory options shared by main.ts and the e2e harness. */
export const NEST_APP_OPTIONS: NestApplicationOptions = {
  bufferLogs: true,
  // req.rawBody is kept for webhook signature checks (HMAC over the exact
  // bytes). Parsers are registered by configureApp (limit + error mapping).
  rawBody: true,
  bodyParser: false,
  // Graceful shutdown (deliberate deviation from forceCloseConnections:
  // true, which would cut in-flight requests): requests arriving after
  // SIGTERM get 503 + Connection: close, in-flight ones finish, and each
  // keep-alive socket is closed as soon as its last response is sent
  // (closeIdleConnectionsWhenStopped), so no client can hold shutdown open.
  return503OnClosing: true,
  forceCloseConnections: false,
};

const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'Idempotency-Key',
  'X-Request-Id',
  'X-Client-Type',
];
const CORS_EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
  'Idempotent-Replayed',
];

/** More hops than this is a misconfiguration that trusts client headers. */
export const MAX_TRUST_PROXY_HOPS = 3;
const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function invalidTrustProxy(reason: string): Error {
  return new Error(`TRUST_PROXY noto‘g‘ri: ${reason}`);
}

/** An IP or a CIDR narrow enough to be a proxy network (not "everyone"). */
function isProxyAddress(item: string): boolean {
  const [address, prefix, ...rest] = item.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  // /0 (or anything this wide) would trust X-Forwarded-For from any client.
  return version === 4 ? bits >= 8 && bits <= 32 : bits >= 32 && bits <= 128;
}

/**
 * Express `trust proxy`: false | hop count (1..3) | comma list of
 * 'loopback' / 'linklocal' / 'uniquelocal' / proxy IPs / CIDRs. Anything
 * that would trust every client (true, huge hop counts, /0 ranges,
 * hostnames) throws: it would let clients spoof req.ip (per-IP limits) and
 * req.secure (HTTPS enforcement) through X-Forwarded-* headers.
 */
export function parseTrustProxy(value: string): false | number | string[] {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'false' || trimmed === '0') return false;
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    if (hops > MAX_TRUST_PROXY_HOPS) {
      throw invalidTrustProxy(`ko‘pi bilan ${MAX_TRUST_PROXY_HOPS} hop`);
    }
    return hops;
  }
  const items = trimmed.split(',').map((item) => item.trim());
  for (const item of items) {
    if (!TRUST_PROXY_NAMES.has(item) && !isProxyAddress(item)) {
      throw invalidTrustProxy(
        `"${item.slice(0, 50)}" (loopback, uniquelocal, IP yoki tor CIDR bering)`,
      );
    }
  }
  return items;
}

export function buildHelmetOptions(
  env: Pick<Env, 'NODE_ENV' | 'HTTPS_REQUIRED' | 'HSTS_MAX_AGE_SECONDS'>,
): HelmetOptions {
  // HSTS only where every response is guaranteed to be served over HTTPS.
  const hstsEnabled = env.NODE_ENV === 'production' && env.HTTPS_REQUIRED;
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hsts: hstsEnabled
      ? { maxAge: env.HSTS_MAX_AGE_SECONDS, includeSubDomains: true }
      : false,
  };
}

function swaggerHelmetOptions(base: HelmetOptions): HelmetOptions {
  return {
    ...base,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  };
}

type TrustFn = (address: string, hop: number) => boolean;

function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // An inbound X-Request-Id counts only if the direct peer is a trusted proxy.
  const trust = req.app.get('trust proxy fn') as TrustFn;
  const fromTrustedProxy = trust(req.socket.remoteAddress ?? '', 0);
  const requestId = resolveRequestId(
    req.headers[REQUEST_ID_HEADER],
    fromTrustedProxy,
  );
  (req as AppRequest).id = requestId;
  res.setHeader('X-Request-Id', requestId);
  RequestContext.run(
    {
      requestId,
      ip: normalizeIp(req.ip),
      userAgent: truncateOptional(req.headers['user-agent'], 512),
    },
    next,
  );
}

/**
 * server.close() closes only the keep-alive sockets idle at that moment; a
 * socket busy with an in-flight request would stay open until
 * keepAliveTimeout once its response is done. Close it right then instead.
 */
function closeIdleConnectionsWhenStopped(server: Server) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (!server.listening) setImmediate(() => server.closeIdleConnections());
    });
    next();
  };
}

/**
 * Turns body-parser failures into AppExceptions before Nest's default
 * mapping (which would echo the JSON parser's message to the client).
 */
function bodyParserErrors(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const { type, status } = err as { type?: unknown; status?: unknown };
  if (
    type === 'entity.too.large' ||
    type === 'parameters.too.many' ||
    status === 413
  ) {
    return next(
      new AppException(413, 'PAYLOAD_TOO_LARGE', ErrorMessages.payloadTooLarge),
    );
  }
  if (type === 'entity.parse.failed') {
    return next(
      new AppException(400, 'INVALID_JSON', ErrorMessages.invalidJson),
    );
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return next(
      new AppException(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        ErrorMessages.unsupportedMediaType,
      ),
    );
  }
  next(err);
}

/**
 * HTTP hardening shared by main.ts and the e2e harness (identical
 * behaviour). Call once, after NestFactory.create and before init/listen.
 */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(PinoNestLogger));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const env = {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    HTTPS_REQUIRED: config.get('HTTPS_REQUIRED', { infer: true }),
    HSTS_MAX_AGE_SECONDS: config.get('HSTS_MAX_AGE_SECONDS', { infer: true }),
  };

  const trustProxy = parseTrustProxy(
    config.get('TRUST_PROXY', { infer: true }),
  );
  if (env.HTTPS_REQUIRED && trustProxy === false) {
    // The app speaks plain HTTP behind a TLS-terminating proxy: without a
    // trusted proxy req.secure is never true and every request would get
    // 403 HTTPS_REQUIRED. Fail at startup instead (always so in production).
    throw new Error(
      'HTTPS_REQUIRED=true uchun TRUST_PROXY majburiy (masalan, nginx orqasida: ' +
        'TRUST_PROXY=1 yoki proxy IP/CIDR)',
    );
  }
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(closeIdleConnectionsWhenStopped(app.getHttpServer() as Server));

  // First: request id + async context, then the access log, so every
  // response (including early rejections below) is correlated and logged.
  app.use(requestContextMiddleware);
  app.use(createHttpLogger());

  const apiHelmet = helmet(buildHelmetOptions(env));
  const docsHelmet = helmet(swaggerHelmetOptions(buildHelmetOptions(env)));
  app.use((req: Request, res: Response, next: NextFunction) =>
    isDocsPath(req.path)
      ? docsHelmet(req, res, next)
      : apiHelmet(req, res, next),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  if (env.HTTPS_REQUIRED) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const healthProbe =
        (req.method === 'GET' || req.method === 'HEAD') && isHealthRequest(req);
      if (req.secure || healthProbe) return next();
      next(
        new AppException(403, 'HTTPS_REQUIRED', ErrorMessages.httpsRequired),
      );
    });
  }

  const allowedOrigins = new Set(config.get('CORS_ORIGINS', { infer: true }));
  app.enableCors({
    // Exact allowlist; unknown origins simply get no CORS headers (never
    // an error, never `*`).
    origin: (origin, callback) =>
      callback(null, origin !== undefined && allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    maxAge: 600,
  });

  // Nothing is served outside the API prefix (and the docs, when enabled);
  // such paths get the standard JSON 404 instead of Express's HTML page.
  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });
  const apiRoot = `/${API_PREFIX}`;
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const inApi = req.path === apiRoot || req.path.startsWith(`${apiRoot}/`);
    if (inApi || (swaggerEnabled && isDocsPath(req.path))) return next();
    next(Errors.notFound());
  });

  app.use(cookieParser());

  const limit = config.get('BODY_LIMIT', { infer: true });
  app.useBodyParser('json', { limit });
  app.useBodyParser('urlencoded', {
    limit,
    extended: false,
    parameterLimit: 100,
  });
  app.use(bodyParserErrors);

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  if (swaggerEnabled) {
    if (env.NODE_ENV === 'production') {
      new Logger('Swagger').warn('Swagger UI is enabled in production');
    }
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Mening Fermam API')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document);
  }
}
