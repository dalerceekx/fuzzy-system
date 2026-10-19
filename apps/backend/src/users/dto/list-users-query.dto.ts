import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
  sortParamValues,
} from '../../common/pagination/index.js';
import { IsUzPhone } from '../../common/validation/index.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import { QueryBoolean } from './query-boolean.decorator.js';

export const USER_SORT_FIELDS = [
  'createdAt',
  'fullName',
  'lastLoginAt',
] as const;

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: sortParamValues(USER_SORT_FIELDS) })
  @IsOptional()
  @IsSortParam(USER_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** Exact match on the normalized number. */
  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @IsUzPhone({ allowDemo: true })
  phone?: string;

  /** Demo accounts are hidden unless requested explicitly. */
  @ApiPropertyOptional()
  @IsOptional()
  @QueryBoolean()
  isDemo?: boolean;
}
