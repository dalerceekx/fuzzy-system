import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
import { TreatmentStatus } from '../../generated/prisma/enums.js';
import { MAX_PROTOCOL_DRUGS } from './protocol.dto.js';
import { OptionalNotNull } from './validators.js';

export class TreatmentItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  medicineId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Shu fermadagi MEDICINE toifali ombor mahsuloti',
  })
  @OptionalNotNull()
  @IsUUID('4')
  inventoryItemId?: string;
}

export class CreateTreatmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  animalId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  protocolVersionId: string;

  @ApiPropertyOptional({
    example: '452.5',
    description: 'Standart: hayvonning saqlangan vazni',
  })
  @OptionalNotNull()
  @IsDecimalString({
    maxIntegerDigits: 4,
    maxFractionDigits: 2,
    min: '0',
    minExclusive: true,
    max: '5000',
  })
  animalWeightKg?: string;

  @ApiPropertyOptional({
    type: [TreatmentItemDto],
    maxItems: MAX_PROTOCOL_DRUGS,
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROTOCOL_DRUGS)
  @ValidateNested({ each: true })
  @Type(() => TreatmentItemDto)
  items?: TreatmentItemDto[];

  @ApiPropertyOptional({ maxLength: 1000 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  notes?: string;
}

export const TREATMENT_SORT_FIELDS = ['startedAt', 'endsOn'] as const;

export class ListTreatmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  animalId?: string;

  @ApiPropertyOptional({ enum: TreatmentStatus })
  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;

  @ApiPropertyOptional({ example: '-startedAt' })
  @IsOptional()
  @IsSortParam(TREATMENT_SORT_FIELDS)
  sort?: string;
}
