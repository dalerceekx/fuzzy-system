import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALL_ROLES } from '../common/auth/roles.js';
import { Roles } from '../common/decorators/index.js';
import { ErrorMessages, Errors } from '../common/errors/app.exception.js';
import { DiseasesService } from './diseases.service.js';
import type {
  DiseaseDetail,
  DiseaseGroupResponse,
  DiseaseSourceResponse,
  DiseaseSummary,
} from './diseases.presenter.js';
import { ListDiseasesQueryDto } from './dto/list-diseases-query.dto.js';

/** `:number` must be an integer (400 INVALID_ID otherwise). */
const DiseaseNumber = (): ParameterDecorator =>
  Param(
    'number',
    new ParseIntPipe({
      exceptionFactory: () =>
        Errors.badRequest('INVALID_ID', ErrorMessages.invalidId),
    }),
  );

// Read-only reference for every signed-in role. Static routes come before
// `:number`, which would otherwise capture them (and 400 on a word).
@ApiTags('diseases')
@ApiBearerAuth()
@Roles(...ALL_ROLES)
@Controller('diseases')
export class DiseasesController {
  constructor(private readonly diseases: DiseasesService) {}

  @Get('groups')
  groups(): Promise<DiseaseGroupResponse[]> {
    return this.diseases.groups();
  }

  @Get('source')
  source(): Promise<DiseaseSourceResponse> {
    return this.diseases.sourceText();
  }

  @Get()
  list(@Query() query: ListDiseasesQueryDto): Promise<DiseaseSummary[]> {
    return this.diseases.list(query);
  }

  @Get(':number')
  get(@DiseaseNumber() number: number): Promise<DiseaseDetail> {
    return this.diseases.get(number);
  }
}
