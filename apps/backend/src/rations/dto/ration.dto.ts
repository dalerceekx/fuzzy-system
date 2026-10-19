import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
} from '../../common/pagination/index.js';
import {
  IsDecimalString,
  SanitizedText,
  type DecimalStringOptions,
} from '../../common/validation/index.js';
import {
  FeedingPurpose,
  PhysiologicalState,
} from '../../generated/prisma/enums.js';
import {
  OptionalNotNull,
  OptionalNullable,
  QueryBoolean,
} from '../../inventory/dto/validators.js';

export const MAX_RATION_ITEMS = 20;
export const RATION_NAME_MAX = 100;
export const RATION_NOTES_MAX = 500;
export const MAX_ANIMAL_COUNT = 1_000_000;
export const MAX_AGE_MONTHS = 600;
export const MAX_RATION_DAYS = 3650;

/** rations.average_weight_kg: Decimal(8, 2), > 0. */
const AVERAGE_WEIGHT_KG: DecimalStringOptions = {
  maxIntegerDigits: 6,
  maxFractionDigits: 2,
  min: '0',
  minExclusive: true,
};
/** rations.milk_yield_liters: Decimal(6, 2), ≥ 0. */
const MILK_YIELD_LITERS: DecimalStringOptions = {
  maxIntegerDigits: 4,
  maxFractionDigits: 2,
  min: '0',
};
/** ration_items.daily_per_animal: Decimal(9, 3), > 0. */
const DAILY_PER_ANIMAL: DecimalStringOptions = {
  maxIntegerDigits: 6,
  maxFractionDigits: 3,
  min: '0',
  minExclusive: true,
};

export class RationItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Shu fermadagi “Yem” (FEED) toifali ombor mahsuloti',
  })
  @IsUUID('4')
  inventoryItemId: string;

  @ApiProperty({
    example: '8',
    description: 'Bir hayvonga kunlik miqdor (mahsulot birligida), > 0',
  })
  @IsDecimalString(DAILY_PER_ANIMAL)
  dailyPerAnimal: string;
}

/** Optional parameters: omitted or `null` both mean "not set". */
export class CreateRationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  animalTypeId: string;

  @ApiProperty({ maxLength: RATION_NAME_MAX })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RATION_NAME_MAX)
  name: string;

  @ApiProperty({ minimum: 1, maximum: MAX_ANIMAL_COUNT })
  @IsInt()
  @Min(1)
  @Max(MAX_ANIMAL_COUNT)
  animalCount: number;

  @ApiPropertyOptional({ example: '450', nullable: true })
  @OptionalNullable()
  @IsDecimalString(AVERAGE_WEIGHT_KG)
  averageWeightKg?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_AGE_MONTHS, nullable: true })
  @OptionalNullable()
  @IsInt()
  @Min(0)
  @Max(MAX_AGE_MONTHS)
  ageMonths?: number | null;

  @ApiProperty({ enum: FeedingPurpose })
  @IsEnum(FeedingPurpose)
  purpose: FeedingPurpose;

  @ApiPropertyOptional({ enum: PhysiologicalState, nullable: true })
  @OptionalNullable()
  @IsEnum(PhysiologicalState)
  physiologicalState?: PhysiologicalState | null;

  @ApiPropertyOptional({ example: '12.5', nullable: true })
  @OptionalNullable()
  @IsDecimalString(MILK_YIELD_LITERS)
  milkYieldLiters?: string | null;

  @ApiProperty({ minimum: 1, maximum: MAX_RATION_DAYS })
  @IsInt()
  @Min(1)
  @Max(MAX_RATION_DAYS)
  days: number;

  @ApiPropertyOptional({ maxLength: RATION_NOTES_MAX, nullable: true })
  @OptionalNullable()
  @SanitizedText()
  @IsString()
  @MaxLength(RATION_NOTES_MAX)
  notes?: string | null;

  @ApiProperty({
    type: [RationItemDto],
    minItems: 1,
    maxItems: MAX_RATION_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RATION_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => RationItemDto)
  items: RationItemDto[];
}

/** Omitted fields stay; `null` clears an optional one; `items` replaces all. */
export class UpdateRationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @OptionalNotNull()
  @IsUUID('4')
  animalTypeId?: string;

  @ApiPropertyOptional({ maxLength: RATION_NAME_MAX })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RATION_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ANIMAL_COUNT })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(MAX_ANIMAL_COUNT)
  animalCount?: number;

  @ApiPropertyOptional({ example: '450', nullable: true })
  @OptionalNullable()
  @IsDecimalString(AVERAGE_WEIGHT_KG)
  averageWeightKg?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_AGE_MONTHS, nullable: true })
  @OptionalNullable()
  @IsInt()
  @Min(0)
  @Max(MAX_AGE_MONTHS)
  ageMonths?: number | null;

  @ApiPropertyOptional({ enum: FeedingPurpose })
  @OptionalNotNull()
  @IsEnum(FeedingPurpose)
  purpose?: FeedingPurpose;

  @ApiPropertyOptional({ enum: PhysiologicalState, nullable: true })
  @OptionalNullable()
  @IsEnum(PhysiologicalState)
  physiologicalState?: PhysiologicalState | null;

  @ApiPropertyOptional({ example: '12.5', nullable: true })
  @OptionalNullable()
  @IsDecimalString(MILK_YIELD_LITERS)
  milkYieldLiters?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_RATION_DAYS })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(MAX_RATION_DAYS)
  days?: number;

  @ApiPropertyOptional({ maxLength: RATION_NOTES_MAX, nullable: true })
  @OptionalNullable()
  @SanitizedText()
  @IsString()
  @MaxLength(RATION_NOTES_MAX)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [RationItemDto],
    minItems: 1,
    maxItems: MAX_RATION_ITEMS,
    description: 'Berilsa, butun ro‘yxatni almashtiradi',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RATION_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => RationItemDto)
  items?: RationItemDto[];
}

export class CopyRationDto {
  @ApiPropertyOptional({
    maxLength: RATION_NAME_MAX,
    description: 'Standart: "<nomi> (nusxa)"',
  })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RATION_NAME_MAX)
  name?: string;
}

export const RATION_SORT_FIELDS = ['createdAt', 'name', 'updatedAt'] as const;

export class ListRationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  farmId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  animalTypeId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ example: '-updatedAt', default: '-updatedAt' })
  @IsOptional()
  @IsSortParam(RATION_SORT_FIELDS)
  sort?: string;
}
