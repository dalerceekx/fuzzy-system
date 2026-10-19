import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/index.js';
import { MAX_RATION_DAYS } from './ration.dto.js';

export class IssueRationDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_RATION_DAYS,
    description: 'Ombordan chiqariladigan oziqlantirish kunlari soni',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_RATION_DAYS)
  days: number;
}

/** Newest first; no other order. */
export class ListRationIssuesQueryDto extends PaginationQueryDto {}
