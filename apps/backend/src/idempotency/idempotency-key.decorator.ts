import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Errors } from '../common/errors/app.exception.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotent-Replayed';
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Required `Idempotency-Key` header (8–128 chars of [A-Za-z0-9_-]). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const value = request.headers[IDEMPOTENCY_HEADER];
    if (value === undefined || value === '') {
      throw Errors.badRequest(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key sarlavhasi majburiy',
      );
    }
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw Errors.badRequest(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key 8–128 ta lotin harf, raqam, "-" yoki "_" dan iborat bo‘lishi kerak',
      );
    }
    return value;
  },
);
