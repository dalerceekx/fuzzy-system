import { ValidateBy, type ValidationOptions } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Password policy shared by admin-created accounts and the bootstrap CLI:
 * 8–128 characters, at least one letter and one digit, not the phone number.
 * Returns an Uzbek message, or null when the password is acceptable.
 */
export function passwordPolicyError(
  password: string,
  phone?: string,
): string | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return `Parol ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} belgidan iborat bo‘lishi kerak`;
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Parolda kamida bitta harf va bitta raqam bo‘lishi kerak';
  }
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const candidates = [phone, digits, digits.slice(3)];
    if (candidates.includes(password)) {
      return 'Parol telefon raqamiga teng bo‘lmasligi kerak';
    }
  }
  return null;
}

/**
 * DTO decorator applying `passwordPolicyError`; compares with the sibling
 * `phone` property when present. Combine with @IsString() + @MaxLength().
 */
export function IsAcceptablePassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAcceptablePassword',
      validator: {
        validate: (value: unknown, args) => {
          if (typeof value !== 'string') return false;
          const phone = (args?.object as { phone?: unknown } | undefined)
            ?.phone;
          return (
            passwordPolicyError(
              value,
              typeof phone === 'string' ? phone : undefined,
            ) === null
          );
        },
        defaultMessage: (args) => {
          const phone = (args?.object as { phone?: unknown } | undefined)
            ?.phone;
          return (
            passwordPolicyError(
              typeof args?.value === 'string' ? args.value : '',
              typeof phone === 'string' ? phone : undefined,
            ) ?? 'Parol talablarga mos emas'
          );
        },
      },
    },
    validationOptions,
  );
}
