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
import { AnimalsService } from './animals.service.js';
import { ArchiveAnimalDto } from './dto/archive-animal.dto.js';
import { CreateAnimalDto } from './dto/create-animal.dto.js';
import { ListAnimalsQueryDto } from './dto/list-animals-query.dto.js';
import { UpdateAnimalDto } from './dto/update-animal.dto.js';

@ApiTags('animals')
@ApiBearerAuth()
@Roles(UserRole.FARMER)
@Controller('animals')
export class AnimalsController {
  constructor(private readonly animals: AnimalsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnimalDto) {
    return this.animals.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListAnimalsQueryDto) {
    return this.animals.list(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return this.animals.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: UpdateAnimalDto,
  ) {
    return this.animals.update(user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: ArchiveAnimalDto,
  ) {
    return this.animals.archive(user.id, id, dto);
  }
}
