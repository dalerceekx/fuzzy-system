import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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
} from '../../common/validation/index.js';
import {
  AdministrationRoute,
  DoseUnit,
  Species,
} from '../../generated/prisma/enums.js';
import { OptionalNotNull } from './validators.js';

export const MAX_PROTOCOL_DRUGS = 20;
/** Same pattern as the protocols_code_chk constraint. */
export const PROTOCOL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;

export class ProtocolDrugDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  medicineId: string;

  @ApiProperty({
    example: '0.2',
    description: 'Doza / kg, o‘nlik son satri > 0',
  })
  @IsDecimalString({
    maxIntegerDigits: 6,
    maxFractionDigits: 4,
    min: '0',
    minExclusive: true,
  })
  dosePerKg: string;

  @ApiProperty({ enum: DoseUnit })
  @IsEnum(DoseUnit)
  doseUnit: DoseUnit;

  @ApiPropertyOptional({
    example: '100',
    description: 'Bir martalik maksimal doza',
  })
  @OptionalNotNull()
  @IsDecimalString({
    maxIntegerDigits: 8,
    maxFractionDigits: 4,
    min: '0',
    minExclusive: true,
  })
  maxSingleDose?: string;

  @ApiProperty({ enum: AdministrationRoute })
  @IsEnum(AdministrationRoute)
  route: AdministrationRoute;

  @ApiProperty({ minimum: 1, maximum: 24 })
  @IsInt()
  @Min(1)
  @Max(24)
  frequencyPerDay: number;

  @ApiProperty({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;
}

export class ProtocolVersionContentDto {
  @ApiProperty({ maxLength: 200 })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 200, example: 'mastit' })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  condition: string;

  @ApiProperty({
    description: 'Shoshilinch protokollar hech qachon dori tavsiyasi bermaydi',
  })
  @IsBoolean()
  isEmergency: boolean;

  @ApiProperty({ maxLength: 5000 })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  instructions: string;

  @ApiProperty({ type: [ProtocolDrugDto], maxItems: MAX_PROTOCOL_DRUGS })
  @IsArray()
  @ArrayMaxSize(MAX_PROTOCOL_DRUGS)
  @ValidateNested({ each: true })
  @Type(() => ProtocolDrugDto)
  drugs: ProtocolDrugDto[];
}

export class CreateProtocolDto {
  @ApiProperty({ example: 'CATTLE-MASTITIS', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  @Matches(PROTOCOL_CODE_PATTERN, {
    message:
      'code katta lotin harflari, raqamlar, "-" yoki "_" dan iborat bo‘lishi kerak (2–50)',
  })
  code: string;

  @ApiProperty({ enum: Species })
  @IsEnum(Species)
  species: Species;

  @ApiProperty({ type: ProtocolVersionContentDto })
  // ValidateNested alone lets a missing object through.
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProtocolVersionContentDto)
  version: ProtocolVersionContentDto;
}

/** DRAFT versions only; `drugs` replaces the whole drug list. */
export class UpdateProtocolVersionDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  condition?: string;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isEmergency?: boolean;

  @ApiPropertyOptional({ maxLength: 5000 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  instructions?: string;

  @ApiPropertyOptional({
    type: [ProtocolDrugDto],
    maxItems: MAX_PROTOCOL_DRUGS,
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROTOCOL_DRUGS)
  @ValidateNested({ each: true })
  @Type(() => ProtocolDrugDto)
  drugs?: ProtocolDrugDto[];
}

export const PROTOCOL_SORT_FIELDS = ['createdAt', 'code'] as const;

export class ListProtocolsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ maxLength: 100, description: 'Kod bo‘yicha qidiruv' })
  @IsOptional()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'code' })
  @IsOptional()
  @IsSortParam(PROTOCOL_SORT_FIELDS)
  sort?: string;
}
