import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
  sortParamValues,
} from '../../common/pagination/index.js';
import { QueryBoolean } from '../../farms/dto/field-decorators.js';
import { Species } from '../../generated/prisma/enums.js';

export const ANIMAL_SORT_FIELDS = ['createdAt', 'tagNumber', 'name'] as const;

export class ListAnimalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: sortParamValues(ANIMAL_SORT_FIELDS) })
  @IsOptional()
  @IsSortParam(ANIMAL_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  farmId?: string;

  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  includeArchived?: boolean;
}
