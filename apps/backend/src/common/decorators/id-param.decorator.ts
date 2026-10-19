import { Param, ParseUUIDPipe } from '@nestjs/common';
import { ErrorMessages, Errors } from '../errors/app.exception.js';

/** Route param that must be a UUID v4 (400 INVALID_ID otherwise). */
export const IdParam = (name = 'id'): ParameterDecorator =>
  Param(
    name,
    new ParseUUIDPipe({
      version: '4',
      exceptionFactory: () =>
        Errors.badRequest('INVALID_ID', ErrorMessages.invalidId),
    }),
  );
