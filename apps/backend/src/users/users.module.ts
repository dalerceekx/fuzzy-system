import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';

// PrismaService, AuditService, SessionService and PasswordService come from
// the global platform modules.
@Module({
  controllers: [AdminUsersController, AuditLogsController],
  providers: [AdminUsersService, AuditLogsService],
})
export class UsersModule {}
