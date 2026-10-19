import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { CurrentUser, IdParam, Roles } from '../common/decorators/index.js';
import type { Paginated } from '../common/pagination/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  IdempotencyKey,
  IDEMPOTENCY_REPLAYED_HEADER,
} from '../idempotency/idempotency-key.decorator.js';
import {
  CreateRationAnimalTypeDto,
  ListRationAnimalTypesQueryDto,
} from './dto/animal-type.dto.js';
import { IssueRationDto, ListRationIssuesQueryDto } from './dto/issue.dto.js';
import {
  CopyRationDto,
  CreateRationDto,
  ListRationsQueryDto,
  UpdateRationDto,
} from './dto/ration.dto.js';
import { RationAnimalTypesService } from './ration-animal-types.service.js';
import { RationIssuesService } from './ration-issues.service.js';
import {
  RATION_PROFILES,
  type RationProfileConfig,
} from './ration-profiles.js';
import type {
  RationAnimalTypeResponse,
  RationIssueResponse,
  RationResponse,
} from './rations.presenter.js';
import { RationsService } from './rations.service.js';

// Static routes (profiles, animal-types) are declared before the `:id`
// routes, which would otherwise capture them (and 400 on a non-UUID id).
@ApiTags('rations')
@ApiBearerAuth()
@Roles(UserRole.FARMER)
@Controller('rations')
export class RationsController {
  constructor(
    private readonly animalTypes: RationAnimalTypesService,
    private readonly rations: RationsService,
    private readonly issues: RationIssuesService,
  ) {}

  @Get('profiles')
  profiles(): readonly RationProfileConfig[] {
    return RATION_PROFILES;
  }

  @Get('animal-types')
  listAnimalTypes(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRationAnimalTypesQueryDto,
  ): Promise<RationAnimalTypeResponse[]> {
    return this.animalTypes.list(user.id, query);
  }

  @Post('animal-types')
  createAnimalType(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRationAnimalTypeDto,
  ): Promise<RationAnimalTypeResponse> {
    return this.animalTypes.create(user.id, dto);
  }

  @Post('animal-types/:id/archive')
  @HttpCode(200)
  archiveAnimalType(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<RationAnimalTypeResponse> {
    return this.animalTypes.archive(user.id, id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRationsQueryDto,
  ): Promise<Paginated<RationResponse>> {
    return this.rations.list(user.id, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRationDto,
  ): Promise<RationResponse> {
    return this.rations.create(user.id, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<RationResponse> {
    return this.rations.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: UpdateRationDto,
  ): Promise<RationResponse> {
    return this.rations.update(user.id, id, dto);
  }

  @Post(':id/copy')
  copy(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Body() dto: CopyRationDto,
  ): Promise<RationResponse> {
    return this.rations.copy(user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<RationResponse> {
    return this.rations.archive(user.id, id);
  }

  @Post(':id/issue')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async issue(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdempotencyKey() key: string,
    @Body() dto: IssueRationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RationIssueResponse> {
    const result = await this.issues.issue(user.id, id, key, dto);
    res.status(result.status);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get(':id/issues')
  listIssues(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Query() query: ListRationIssuesQueryDto,
  ): Promise<Paginated<RationIssueResponse>> {
    return this.issues.list(user.id, id, query);
  }
}
