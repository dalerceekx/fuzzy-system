import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppRequest } from '../common/auth/auth-user.js';
import type { Env } from '../config/env.js';
import { getRootLogger } from './logger.js';

/**
 * Backs Nest's Logger with pino (structured JSON). The per-request access
 * log line is written by the middleware from http-logger.ts (mounted in
 * configureApp); nestjs-pino only provides request-scoped loggers here.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          logger: getRootLogger({
            level: config.get('LOG_LEVEL', { infer: true }),
            pretty:
              config.get('LOG_PRETTY', { infer: true }) &&
              config.get('NODE_ENV', { infer: true }) === 'development',
          }),
          autoLogging: false,
          quietReqLogger: true,
          wrapSerializers: false,
          genReqId: (req) => (req as AppRequest).id,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
