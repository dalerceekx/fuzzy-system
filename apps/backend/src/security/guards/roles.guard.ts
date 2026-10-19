import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../../common/auth/auth-user.js';
import { Errors } from '../../common/errors/app.exception.js';
import { routeAccess } from './route-access.js';

/**
 * Fail-closed authorization: a route must declare @Public() or @Roles(...).
 * Missing (or empty) role metadata → 403, so a forgotten decorator can never
 * expose an endpoint.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const access = routeAccess(this.reflector, context);
    if (access.isPublic) return true;
    if (!access.roles || access.roles.length === 0) throw Errors.forbidden();

    const { user } = context.switchToHttp().getRequest<AppRequest>();
    if (!user) throw Errors.unauthorized();
    if (!access.roles.includes(user.role)) throw Errors.forbidden();
    return true;
  }
}
