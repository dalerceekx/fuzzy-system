import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  CreateTreatmentDto,
  ListTreatmentsQueryDto,
} from './dto/treatment.dto.js';
import { TreatmentsService } from './treatments.service.js';
import type { TreatmentResponse } from './vet.presenter.js';

@ApiTags('vet')
@ApiBearerAuth()
@Roles(UserRole.FARMER)
@Controller('vet/treatments')
export class TreatmentsController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey() key: string,
    @Body() dto: CreateTreatmentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TreatmentResponse> {
    const result = await this.treatments.create(user.id, key, dto);
    res.status(result.status);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListTreatmentsQueryDto,
  ): Promise<Paginated<TreatmentResponse>> {
    return this.treatments.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<TreatmentResponse> {
    return this.treatments.get(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<TreatmentResponse> {
    return this.treatments.complete(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<TreatmentResponse> {
    return this.treatments.cancel(user.id, id);
  }
}
