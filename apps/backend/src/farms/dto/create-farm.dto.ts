import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CleanText, OptionalField } from './field-decorators.js';

export const FARM_NAME_MAX = 100;
export const FARM_REGION_MAX = 100;

export class CreateFarmDto {
  @ApiProperty({ maxLength: FARM_NAME_MAX })
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FARM_NAME_MAX)
  name: string;

  @ApiPropertyOptional({ maxLength: FARM_REGION_MAX })
  @OptionalField()
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FARM_REGION_MAX)
  region?: string;
}
