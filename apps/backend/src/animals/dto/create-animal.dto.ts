import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsDecimalString } from '../../common/validation/index.js';
import {
  CanonicalCode,
  CleanText,
  OptionalField,
} from '../../farms/dto/field-decorators.js';
import { AnimalSex, Species } from '../../generated/prisma/enums.js';
import { IsPastDateOnly } from './is-past-date-only.js';

export const TAG_NUMBER_MAX = 50;
export const ANIMAL_NAME_MAX = 100;
export const ANIMAL_NOTES_MAX = 1000;

// Ear-tag style identifiers, checked after @CanonicalCode: ASCII only, so a
// Cyrillic or fullwidth look-alike can never be a second active "same" tag.
export const TAG_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 ._\-/#]*$/;
export const TAG_NUMBER_MESSAGE =
  'tagNumber faqat lotin harflari, raqamlar va . _ - / # belgilaridan iborat';

/** Decimal string > 0 and ≤ 5000 with at most 2 decimals (DB: numeric(8,2)). */
export const WEIGHT_KG = {
  maxIntegerDigits: 4,
  maxFractionDigits: 2,
  min: '0',
  minExclusive: true,
  max: '5000',
};

export class CreateAnimalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId: string;

  @ApiProperty({ maxLength: TAG_NUMBER_MAX })
  @CanonicalCode()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NUMBER_MAX)
  @Matches(TAG_NUMBER_PATTERN, { message: TAG_NUMBER_MESSAGE })
  tagNumber: string;

  @ApiProperty({ enum: Species })
  @IsEnum(Species)
  species: Species;

  @ApiPropertyOptional({ enum: AnimalSex, default: AnimalSex.UNKNOWN })
  @OptionalField()
  @IsEnum(AnimalSex)
  sex?: AnimalSex;

  @ApiPropertyOptional({ maxLength: ANIMAL_NAME_MAX })
  @OptionalField()
  @CleanText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANIMAL_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ example: '2024-05-01' })
  @OptionalField()
  @IsPastDateOnly()
  birthDate?: string;

  @ApiPropertyOptional({ example: '452.50' })
  @OptionalField()
  @IsDecimalString(WEIGHT_KG)
  weightKg?: string;

  @ApiPropertyOptional({ maxLength: ANIMAL_NOTES_MAX })
  @OptionalField()
  @CleanText()
  @IsString()
  @MaxLength(ANIMAL_NOTES_MAX)
  notes?: string;
}
