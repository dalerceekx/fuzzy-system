import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, AuthUser } from '../auth/auth-user.js';
import { Errors } from '../errors/app.exception.js';

/** The authenticated user (role loaded from the database). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.user) throw Errors.unauthorized();
    return request.user;
  },
);
