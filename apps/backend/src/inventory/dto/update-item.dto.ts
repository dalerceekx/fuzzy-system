import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsDecimalString,
  SanitizedText,
} from '../../common/validation/index.js';
import {
  IsDateOnly,
  MIN_QUANTITY,
  OptionalNotNull,
  OptionalNullable,
  UNIT_PRICE,
} from './validators.js';

/**
 * Metadata only: quantity changes exclusively through stock movements, and
 * farm/category/unit/medicine are fixed once stock has been recorded.
 * `null` clears an optional field (unitPrice too; the next priced IN
 * movement sets it again).
 */
export class UpdateInventoryItemDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @OptionalNotNull()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  @OptionalNullable()
  @SanitizedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  batchNumber?: string | null;

  @ApiPropertyOptional({ example: '2027-01-31', nullable: true })
  @OptionalNullable()
  @IsDateOnly()
  expiresOn?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650, nullable: true })
  @OptionalNullable()
  @IsInt()
  @Min(1)
  @Max(3650)
  useWithinDaysAfterOpening?: number | null;

  @ApiPropertyOptional({ example: '3500.00', nullable: true })
  @OptionalNullable()
  @IsDecimalString(UNIT_PRICE)
  unitPrice?: string | null;

  @ApiPropertyOptional({ example: '50', nullable: true })
  @OptionalNullable()
  @IsDecimalString(MIN_QUANTITY)
  minQuantity?: string | null;
}
