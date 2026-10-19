import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
  sortParamValues,
} from '../../common/pagination/index.js';
import { QueryBoolean } from './field-decorators.js';

export const FARM_SORT_FIELDS = ['createdAt', 'name'] as const;

export class ListFarmsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: sortParamValues(FARM_SORT_FIELDS) })
  @IsOptional()
  @IsSortParam(FARM_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  includeArchived?: boolean;
}
