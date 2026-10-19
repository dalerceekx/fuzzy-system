import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import type { UserRole } from '../../generated/prisma/enums.js';

export interface RouteAccess {
  isPublic: boolean;
  roles: readonly UserRole[] | undefined;
}

/**
 * Reads @Public/@Roles from the handler, then the controller. A route that
 * carries both is treated as protected (fail closed), never as public.
 */
export function routeAccess(
  reflector: Reflector,
  context: ExecutionContext,
): RouteAccess {
  const targets = [context.getHandler(), context.getClass()];
  const roles = reflector.getAllAndOverride<readonly UserRole[] | undefined>(
    ROLES_KEY,
    targets,
  );
  const publicFlag = reflector.getAllAndOverride<boolean | undefined>(
    IS_PUBLIC_KEY,
    targets,
  );
  return { isPublic: publicFlag === true && roles === undefined, roles };
}
