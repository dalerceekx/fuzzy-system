import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { IsUzPhone, SanitizedText } from '../../common/validation/index.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  IsAcceptablePassword,
  PASSWORD_MAX_LENGTH,
} from '../password-policy.js';

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 100;

export class CreateUserDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  @IsUzPhone()
  phone: string;

  @ApiProperty({ minLength: FULL_NAME_MIN, maxLength: FULL_NAME_MAX })
  @SanitizedText()
  @IsString()
  @MinLength(FULL_NAME_MIN)
  @MaxLength(FULL_NAME_MAX)
  fullName: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @IsAcceptablePassword()
  password: string;
}
