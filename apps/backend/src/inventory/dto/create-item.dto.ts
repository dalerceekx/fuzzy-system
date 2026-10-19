import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsDecimalString,
  SanitizedText,
} from '../../common/validation/index.js';
import {
  InventoryCategory,
  InventoryUnit,
} from '../../generated/prisma/enums.js';
import {
  INITIAL_QUANTITY,
  IsDateOnly,
  MIN_QUANTITY,
  OptionalNotNull,
  UNIT_PRICE,
} from './validators.js';

export class CreateInventoryItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId: string;

  @ApiProperty({ maxLength: 120 })
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: InventoryCategory })
  @IsEnum(InventoryCategory)
  category: InventoryCategory;

  @ApiProperty({ enum: InventoryUnit })
  @IsEnum(InventoryUnit)
  unit: InventoryUnit;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Faqat MEDICINE toifasi uchun; dori APPROVED bo‘lishi shart',
  })
  @OptionalNotNull()
  @IsUUID('4')
  medicineId?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  batchNumber?: string;

  @ApiPropertyOptional({ example: '2027-01-31' })
  @OptionalNotNull()
  @IsDateOnly()
  expiresOn?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(3650)
  useWithinDaysAfterOpening?: number;

  @ApiPropertyOptional({
    example: '3500.00',
    description: 'Bir birlik narxi (so‘m), o‘nlik son satri ≥ 0',
  })
  @OptionalNotNull()
  @IsDecimalString(UNIT_PRICE)
  unitPrice?: string;

  @ApiPropertyOptional({
    example: '50',
    description: 'Kam qoldiq chegarasi, o‘nlik son satri ≥ 0',
  })
  @OptionalNotNull()
  @IsDecimalString(MIN_QUANTITY)
  minQuantity?: string;

  @ApiPropertyOptional({
    example: '500',
    description:
      'Boshlang‘ich qoldiq (> 0): shu tranzaksiyada IN harakati sifatida yoziladi',
  })
  @OptionalNotNull()
  @IsDecimalString(INITIAL_QUANTITY)
  initialQuantity?: string;
}
