import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsJWT,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsUzPhone } from '../../common/validation/is-uz-phone.decorator.js';
import { SanitizedText } from '../../common/validation/sanitized-text.decorator.js';
import { IsPasswordPolicy, PASSWORD_MAX_LENGTH } from '../password-policy.js';

const SIX_DIGITS = /^\d{6}$/;
const CODE_MESSAGE = 'Kod 6 ta raqamdan iborat bo‘lishi kerak';
const MAX_TOKEN_LENGTH = 4096;

// No role/status/isDemo fields anywhere: the global ValidationPipe
// (forbidNonWhitelisted) rejects them, so they cannot be injected.

export class RegisterDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  @IsUzPhone()
  phone: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @SanitizedText()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX_LENGTH })
  @IsPasswordPolicy()
  password: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  verificationId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(6)
  @Matches(SIX_DIGITS, { message: CODE_MESSAGE })
  code: string;
}

export class ResendOtpDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  verificationId: string;
}

export class LoginDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  @IsUzPhone({ allowDemo: true })
  phone: string;

  // Not the policy: existing passwords are only checked, never validated.
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class MfaTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_TOKEN_LENGTH)
  @IsJWT()
  mfaToken: string;
}

export class MfaCodeDto extends MfaTokenDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(6)
  @Matches(SIX_DIGITS, { message: CODE_MESSAGE })
  code: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description: 'Mobile clients only; web clients use the HttpOnly cookie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TOKEN_LENGTH)
  @IsJWT()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  @IsUzPhone()
  phone: string;
}

export class ResetPasswordDto extends VerifyPhoneDto {
  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX_LENGTH })
  @IsPasswordPolicy()
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX_LENGTH })
  @IsPasswordPolicy()
  newPassword: string;
}
