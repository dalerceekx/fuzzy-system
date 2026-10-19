import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser, IdParam, Roles } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminReasonDto } from './dto/admin-reason.dto.js';
import { ChangeRoleDto } from './dto/change-role.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';

const { SUPER_ADMIN, ADMIN, SUPPORT } = UserRole;

/**
 * Staff user management. The role lists below are only the first gate:
 * AdminUsersService re-checks the actor's current role inside each
 * mutation's transaction and applies the target-specific rules.
 */
@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @Roles(SUPER_ADMIN, ADMIN, SUPPORT)
  list(@CurrentUser() actor: AuthUser, @Query() query: ListUsersQueryDto) {
    return this.users.list(actor, query);
  }

  @Get(':id')
  @Roles(SUPER_ADMIN, ADMIN, SUPPORT)
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.get(actor, id);
  }

  @Post()
  @Roles(SUPER_ADMIN, ADMIN)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(':id/role')
  @Roles(SUPER_ADMIN, ADMIN)
  changeRole(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.users.changeRole(actor, id, dto.role);
  }

  @Post(':id/block')
  @Roles(SUPER_ADMIN, ADMIN)
  @HttpCode(HttpStatus.OK)
  block(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.users.block(actor, id, dto.reason);
  }

  @Post(':id/unblock')
  @Roles(SUPER_ADMIN, ADMIN)
  @HttpCode(HttpStatus.OK)
  unblock(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.unblock(actor, id);
  }

  @Post(':id/archive')
  @Roles(SUPER_ADMIN, ADMIN)
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.users.archive(actor, id, dto.reason);
  }

  @Post(':id/sessions/revoke')
  @Roles(SUPER_ADMIN, ADMIN)
  @HttpCode(HttpStatus.OK)
  revokeSessions(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.revokeAllSessions(actor, id);
  }

  @Post(':id/mfa/reset')
  @Roles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  resetMfa(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.resetMfa(actor, id);
  }
}
