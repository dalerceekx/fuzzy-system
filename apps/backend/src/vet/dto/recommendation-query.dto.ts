import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/index.js';
import { SanitizedText } from '../../common/validation/index.js';
import { Species } from '../../generated/prisma/enums.js';
import { QueryBoolean } from './validators.js';

export class RecommendationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Kasallik nomi (katta-kichik harf farqsiz qism-satr)',
  })
  @IsOptional()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  condition?: string;

  @ApiPropertyOptional({
    description: 'true: hech qanday dori tavsiya qilinmaydi',
    default: false,
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  emergency?: boolean;
}
