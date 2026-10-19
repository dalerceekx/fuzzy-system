import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth-user.js';
import { ALL_ROLES } from '../common/auth/roles.js';
import { CurrentUser, IdParam, Roles } from '../common/decorators/index.js';
import type { Paginated } from '../common/pagination/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  CreateProtocolDto,
  ListProtocolsQueryDto,
  UpdateProtocolVersionDto,
} from './dto/protocol.dto.js';
import { ProtocolsService } from './protocols.service.js';
import type {
  ProtocolResponse,
  ProtocolVersionResponse,
} from './vet.presenter.js';

@ApiTags('vet')
@ApiBearerAuth()
@Controller('vet/protocols')
export class ProtocolsController {
  constructor(private readonly protocols: ProtocolsService) {}

  /** Staff see every version; farmers only the APPROVED version's content. */
  @Get()
  @Roles(...ALL_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListProtocolsQueryDto,
  ): Promise<Paginated<ProtocolResponse>> {
    return this.protocols.list(user, query);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<ProtocolResponse> {
    return this.protocols.get(user, id);
  }

  @Get(':id/versions/:versionId')
  @Roles(...ALL_ROLES)
  getVersion(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdParam('versionId') versionId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.protocols.getVersion(user, id, versionId);
  }

  @Post()
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProtocolDto,
  ): Promise<ProtocolResponse> {
    return this.protocols.create(user, dto);
  }

  @Post(':id/versions')
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createVersion(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<ProtocolVersionResponse> {
    return this.protocols.createVersion(user, id);
  }

  @Patch(':id/versions/:versionId')
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updateVersion(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdParam('versionId') versionId: string,
    @Body() dto: UpdateProtocolVersionDto,
  ): Promise<ProtocolVersionResponse> {
    return this.protocols.updateVersion(user, id, versionId, dto);
  }

  @Post(':id/versions/:versionId/approve')
  @HttpCode(200)
  @Roles(UserRole.VET)
  approveVersion(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdParam('versionId') versionId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.protocols.approveVersion(user, id, versionId);
  }

  @Post(':id/versions/:versionId/archive')
  @HttpCode(200)
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  archiveVersion(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdParam('versionId') versionId: string,
  ): Promise<ProtocolVersionResponse> {
    return this.protocols.archiveVersion(user, id, versionId);
  }
}
