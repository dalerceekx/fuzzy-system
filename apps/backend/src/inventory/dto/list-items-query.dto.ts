import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
} from '../../common/pagination/index.js';
import { InventoryCategory } from '../../generated/prisma/enums.js';
import { QueryBoolean } from './validators.js';

export const ITEM_SORT_FIELDS = ['createdAt', 'name', 'expiresOn'] as const;

export class ListInventoryItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  farmId?: string;

  @ApiPropertyOptional({ enum: InventoryCategory })
  @IsOptional()
  @IsEnum(InventoryCategory)
  category?: InventoryCategory;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ example: '-createdAt' })
  @IsOptional()
  @IsSortParam(ITEM_SORT_FIELDS)
  sort?: string;
}
