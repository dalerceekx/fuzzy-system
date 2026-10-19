import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SanitizedText } from '../../common/validation/index.js';
import {
  AnimalSex,
  RationProfile,
  Species,
} from '../../generated/prisma/enums.js';
import {
  OptionalNotNull,
  OptionalNullable,
  QueryBoolean,
} from '../../inventory/dto/validators.js';

export const ANIMAL_TYPE_NAME_MAX = 60;
/** A category is for one sex or (null) for any; never UNKNOWN. */
export const ANIMAL_TYPE_SEXES = [AnimalSex.MALE, AnimalSex.FEMALE] as const;
export type AnimalTypeSex = (typeof ANIMAL_TYPE_SEXES)[number];

export class CreateRationAnimalTypeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId: string;

  @ApiProperty({ maxLength: ANIMAL_TYPE_NAME_MAX, example: 'Buzoq' })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANIMAL_TYPE_NAME_MAX)
  name: string;

  @ApiProperty({ enum: Species })
  @IsEnum(Species)
  species: Species;

  @ApiPropertyOptional({ enum: RationProfile, default: RationProfile.OTHER })
  @OptionalNotNull()
  @IsEnum(RationProfile)
  profile?: RationProfile;

  @ApiPropertyOptional({
    enum: ANIMAL_TYPE_SEXES,
    nullable: true,
    description: 'null yoki berilmasa — har ikkala jins',
  })
  @OptionalNullable()
  @IsIn(ANIMAL_TYPE_SEXES)
  sex?: AnimalTypeSex | null;
}

export class ListRationAnimalTypesQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeArchived?: boolean;
}
