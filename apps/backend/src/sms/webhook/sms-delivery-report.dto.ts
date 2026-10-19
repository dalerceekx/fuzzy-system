import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const PROVIDER_TOKEN = /^[A-Za-z0-9._:-]+$/;

export class SmsDeliveryReportDto {
  @IsString()
  @MaxLength(100)
  @Matches(PROVIDER_TOKEN)
  messageId!: string;

  @IsIn(['DELIVERED', 'FAILED'])
  status!: 'DELIVERED' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(PROVIDER_TOKEN)
  errorCode?: string;
}
