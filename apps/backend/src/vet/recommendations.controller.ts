import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { RecommendationQueryDto } from './dto/recommendation-query.dto.js';
import {
  RecommendationsService,
  type RecommendationsResponse,
} from './recommendations.service.js';

@ApiTags('vet')
@ApiBearerAuth()
@Roles(UserRole.FARMER, UserRole.VET)
@Controller('vet/recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /**
   * Only APPROVED, non-emergency protocol versions whose medicines are all
   * APPROVED. `emergency=true` never returns any medicine.
   */
  @Get()
  recommend(
    @Query() query: RecommendationQueryDto,
  ): Promise<RecommendationsResponse> {
    return this.recommendations.recommend(query);
  }
}
