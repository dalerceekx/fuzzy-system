import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Password policy for every DTO field that sets a new password. */
export function IsPasswordPolicy(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: 'Parol matn bo‘lishi kerak' }),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `Parol kamida ${PASSWORD_MIN_LENGTH} belgidan iborat bo‘lsin`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `Parol ${PASSWORD_MAX_LENGTH} belgidan oshmasin`,
    }),
    Matches(/\p{L}/u, { message: 'Parolda kamida bitta harf bo‘lsin' }),
    Matches(/\p{Nd}/u, { message: 'Parolda kamida bitta raqam bo‘lsin' }),
  );
}

/**
 * True when the password is (or is built around) the account's own phone
 * number, e.g. '901234567', '+998 90 123 45 67' or 'a998901234567'. The
 * letter+digit rule alone would still allow 'x901234567'.
 */
export function passwordContainsPhone(
  password: string,
  phone: string,
): boolean {
  const local = phone.replace(/\D/g, '').slice(-9);
  if (local.length !== 9) return false;
  const digits = password.replace(/[\s()+.-]/g, '');
  return digits.includes(local);
}
