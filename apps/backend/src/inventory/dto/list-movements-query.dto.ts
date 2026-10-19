import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
} from '../../common/pagination/index.js';

export const MOVEMENT_SORT_FIELDS = ['createdAt'] as const;

export class ListStockMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '-createdAt' })
  @IsOptional()
  @IsSortParam(MOVEMENT_SORT_FIELDS)
  sort?: string;
}
