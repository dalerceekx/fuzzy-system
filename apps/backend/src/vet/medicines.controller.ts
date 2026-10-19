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
  CreateMedicineDto,
  ListMedicinesQueryDto,
  UpdateMedicineDto,
} from './dto/medicine.dto.js';
import { MedicinesService } from './medicines.service.js';
import type { MedicineResponse } from './vet.presenter.js';

@ApiTags('vet')
@ApiBearerAuth()
@Controller('vet/medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  /** Staff see every status; farmers only APPROVED medicines. */
  @Get()
  @Roles(...ALL_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMedicinesQueryDto,
  ): Promise<Paginated<MedicineResponse>> {
    return this.medicines.list(user, query);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<MedicineResponse> {
    return this.medicines.get(user, id);
  }

  @Post()
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMedicineDto,
  ): Promise<MedicineResponse> {
    return this.medicines.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: UpdateMedicineDto,
  ): Promise<MedicineResponse> {
    return this.medicines.update(user, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(UserRole.VET)
  approve(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<MedicineResponse> {
    return this.medicines.approve(user, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Roles(UserRole.VET, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  archive(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<MedicineResponse> {
    return this.medicines.archive(user, id);
  }
}
