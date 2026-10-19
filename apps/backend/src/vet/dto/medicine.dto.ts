import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
} from '../../common/pagination/index.js';
import { SanitizedText } from '../../common/validation/index.js';
import { MedicineStatus } from '../../generated/prisma/enums.js';
import { OptionalNotNull, OptionalNullable } from './validators.js';

export class CreateMedicineDto {
  @ApiProperty({ maxLength: 150 })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ maxLength: 150 })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  activeIngredient: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  form?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  concentration?: string;

  @ApiProperty({ minimum: 0, maximum: 3650 })
  @IsInt()
  @Min(0)
  @Max(3650)
  withdrawalMeatDays: number;

  @ApiProperty({ minimum: 0, maximum: 3650 })
  @IsInt()
  @Min(0)
  @Max(3650)
  withdrawalMilkDays: number;
}

/** DRAFT medicines only; `null` clears form/concentration. */
export class UpdateMedicineDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  activeIngredient?: string;

  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @OptionalNullable()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  form?: string | null;

  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @OptionalNullable()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  concentration?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 3650 })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(3650)
  withdrawalMeatDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3650 })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(3650)
  withdrawalMilkDays?: number;
}

export const MEDICINE_SORT_FIELDS = ['createdAt', 'name'] as const;

export class ListMedicinesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MedicineStatus,
    description: 'Fermer faqat APPROVED dorilarni ko‘radi',
  })
  @IsOptional()
  @IsEnum(MedicineStatus)
  status?: MedicineStatus;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Nomi yoki ta’sir etuvchi moddasi bo‘yicha qidiruv',
  })
  @IsOptional()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'name' })
  @IsOptional()
  @IsSortParam(MEDICINE_SORT_FIELDS)
  sort?: string;
}
