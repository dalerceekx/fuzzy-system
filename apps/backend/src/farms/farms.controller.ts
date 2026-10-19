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
import { CreateFarmDto } from './dto/create-farm.dto.js';
import { ListFarmsQueryDto } from './dto/list-farms-query.dto.js';
import { UpdateFarmDto } from './dto/update-farm.dto.js';
import { FarmsService } from './farms.service.js';

@ApiTags('farms')
@ApiBearerAuth()
@Roles(UserRole.FARMER)
@Controller('farms')
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFarmDto) {
    return this.farms.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListFarmsQueryDto) {
    return this.farms.list(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return this.farms.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: UpdateFarmDto,
  ) {
    return this.farms.update(user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return this.farms.archive(user.id, id);
  }
}
