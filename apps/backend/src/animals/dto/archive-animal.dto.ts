import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CleanText } from '../../farms/dto/field-decorators.js';

export const ARCHIVE_REASON_MAX = 500;

export class ArchiveAnimalDto {
  @ApiProperty({ maxLength: ARCHIVE_REASON_MAX })
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ARCHIVE_REASON_MAX)
  reason: string;
}
