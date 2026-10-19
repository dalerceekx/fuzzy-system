import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SanitizedText } from '../../common/validation/index.js';
import { DiseaseAnimal } from '../../generated/prisma/enums.js';

export const DISEASE_QUERY_MAX = 100;
/** Groups of the 'kasalliklar-v1' source. */
export const DISEASE_GROUP_MAX = 4;

/** Filters combine (AND); no filter = every disease. */
export class ListDiseasesQueryDto {
  @ApiPropertyOptional({ enum: DiseaseAnimal })
  @IsOptional()
  @IsEnum(DiseaseAnimal)
  animal?: DiseaseAnimal;

  @ApiPropertyOptional({ minimum: 1, maximum: DISEASE_GROUP_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DISEASE_GROUP_MAX)
  groupNumber?: number;

  @ApiPropertyOptional({
    maxLength: DISEASE_QUERY_MAX,
    description:
      'Nom va xalq tilidagi belgilar ichidan qidiradi (har bir so‘z bo‘lishi kerak)',
  })
  @IsOptional()
  @SanitizedText()
  @IsString()
  @MaxLength(DISEASE_QUERY_MAX)
  q?: string;
}
