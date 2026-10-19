import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsDecimalString } from '../../common/validation/index.js';
import {
  CanonicalCode,
  CleanText,
  NullableField,
  OptionalField,
} from '../../farms/dto/field-decorators.js';
import { AnimalSex, Species } from '../../generated/prisma/enums.js';
import {
  ANIMAL_NAME_MAX,
  ANIMAL_NOTES_MAX,
  TAG_NUMBER_MAX,
  TAG_NUMBER_MESSAGE,
  TAG_NUMBER_PATTERN,
  WEIGHT_KG,
} from './create-animal.dto.js';
import { IsPastDateOnly } from './is-past-date-only.js';

/** farmId cannot be changed; `null` clears name, birthDate and notes. */
export class UpdateAnimalDto {
  @ApiPropertyOptional({ maxLength: TAG_NUMBER_MAX })
  @OptionalField()
  @CanonicalCode()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NUMBER_MAX)
  @Matches(TAG_NUMBER_PATTERN, { message: TAG_NUMBER_MESSAGE })
  tagNumber?: string;

  @ApiPropertyOptional({ enum: Species })
  @OptionalField()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ enum: AnimalSex })
  @OptionalField()
  @IsEnum(AnimalSex)
  sex?: AnimalSex;

  @ApiPropertyOptional({ maxLength: ANIMAL_NAME_MAX, nullable: true })
  @NullableField()
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANIMAL_NAME_MAX)
  name?: string | null;

  @ApiPropertyOptional({ example: '2024-05-01', nullable: true })
  @NullableField()
  @IsPastDateOnly()
  birthDate?: string | null;

  /** Weight can be corrected but never removed (treatments rely on it). */
  @ApiPropertyOptional({ example: '452.50' })
  @OptionalField()
  @IsDecimalString(WEIGHT_KG)
  weightKg?: string;

  @ApiPropertyOptional({ maxLength: ANIMAL_NOTES_MAX, nullable: true })
  @NullableField()
  @CleanText()
  @IsString()
  @MaxLength(ANIMAL_NOTES_MAX)
  notes?: string | null;
}
