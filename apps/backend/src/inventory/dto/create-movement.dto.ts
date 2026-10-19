import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalString,
  SanitizedText,
} from '../../common/validation/index.js';
import { StockMovementType } from '../../generated/prisma/enums.js';
import { isAdjustment } from '../stock-balance.js';

export class CreateStockMovementDto {
  @ApiProperty({ enum: StockMovementType })
  @IsEnum(StockMovementType)
  type: StockMovementType;

  @ApiProperty({ example: '12.5', description: 'O‘nlik son satri, > 0' })
  @IsDecimalString({
    maxIntegerDigits: 11,
    maxFractionDigits: 3,
    min: '0',
    minExclusive: true,
  })
  quantity: string;

  /** Required together with `currency` (DB check enforces both-or-neither). */
  @ApiPropertyOptional({ example: '15000.00' })
  @ValidateIf(
    (o: CreateStockMovementDto) =>
      o.unitCost !== undefined || o.currency !== undefined,
  )
  @IsDecimalString({ maxIntegerDigits: 14, maxFractionDigits: 2, min: '0' })
  unitCost?: string;

  @ApiPropertyOptional({ example: 'UZS' })
  @ValidateIf(
    (o: CreateStockMovementDto) =>
      o.unitCost !== undefined || o.currency !== undefined,
  )
  @IsString()
  @MaxLength(3)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency 3 ta katta lotin harfidan iborat bo‘lishi kerak',
  })
  currency?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'ADJUSTMENT_IN / ADJUSTMENT_OUT uchun majburiy',
  })
  @ValidateIf(
    (o: CreateStockMovementDto) =>
      o.reason !== undefined || isAdjustment(o.type),
  )
  @SanitizedText()
  @IsString()
  @IsNotEmpty({ message: 'reason tuzatish uchun majburiy' })
  @MaxLength(500)
  reason?: string;
}
