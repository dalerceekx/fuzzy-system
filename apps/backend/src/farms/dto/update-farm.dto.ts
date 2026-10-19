import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { FARM_NAME_MAX, FARM_REGION_MAX } from './create-farm.dto.js';
import { CleanText, NullableField, OptionalField } from './field-decorators.js';

export class UpdateFarmDto {
  @ApiPropertyOptional({ maxLength: FARM_NAME_MAX })
  @OptionalField()
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FARM_NAME_MAX)
  name?: string;

  /** `null` clears the region. */
  @ApiPropertyOptional({ maxLength: FARM_REGION_MAX, nullable: true })
  @NullableField()
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FARM_REGION_MAX)
  region?: string | null;
}
