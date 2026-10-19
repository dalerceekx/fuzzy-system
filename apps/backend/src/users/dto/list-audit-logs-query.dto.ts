import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
  sortParamValues,
} from '../../common/pagination/index.js';

export const AUDIT_SORT_FIELDS = ['timestamp'] as const;

// Same shape as the audit_logs_action_chk constraint, e.g. 'user.role.changed'.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z_]*$/;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
// A date, or a date-time with an explicit zone, so the server's local time
// zone never changes the meaning of a filter.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2}))?$/;

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: sortParamValues(AUDIT_SORT_FIELDS) })
  @IsOptional()
  @IsSortParam(AUDIT_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({ example: 'user.role.changed' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(ACTION_PATTERN)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(RESOURCE_TYPE_PATTERN)
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(RESOURCE_ID_PATTERN)
  resourceId?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(TIMESTAMP_PATTERN)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(TIMESTAMP_PATTERN)
  @IsISO8601({ strict: true })
  to?: string;
}
