import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'auth:roles';

/**
 * Roles allowed to call the route (checked against the role currently stored
 * in the database). A route without @Roles or @Public is rejected (403).
 */
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, Object.freeze([...roles]));
