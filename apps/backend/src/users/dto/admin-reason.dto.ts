import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizedText } from '../../common/validation/index.js';

export const REASON_MIN = 3;
// users.blocked_reason is VARCHAR(500).
export const REASON_MAX = 500;

/** Body of block/archive: the reason is stored and audited. */
export class AdminReasonDto {
  @ApiProperty({ minLength: REASON_MIN, maxLength: REASON_MAX })
  @SanitizedText()
  @IsString()
  @MinLength(REASON_MIN)
  @MaxLength(REASON_MAX)
  reason: string;
}
