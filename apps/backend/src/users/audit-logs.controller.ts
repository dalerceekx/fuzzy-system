import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { AuditLogsService } from './audit-logs.service.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

/** Read-only by design: there are no update/delete routes for audit rows. */
@ApiTags('admin-audit-logs')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: ListAuditLogsQueryDto) {
    return this.auditLogs.list(actor, query);
  }
}
