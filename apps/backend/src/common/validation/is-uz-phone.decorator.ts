import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isDemoPhone, normalizePhone } from '../phone.js';

export const IS_UZ_PHONE = 'isUzPhone';

export interface IsUzPhoneOptions {
  /**
   * Demo numbers (+998000000NNN) are rejected by default so they can never
   * be registered or used by real flows. Login may allow them; the login
   * service still refuses demo users while DEMO_ACCOUNTS_ENABLED=false.
   */
  allowDemo?: boolean;
}

/**
 * Normalizes an Uzbek phone number (see `normalizePhone`) and validates it.
 * Use together with `@IsString()` and `@MaxLength(32)`.
 */
export function IsUzPhone(
  options: IsUzPhoneOptions = {},
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? (normalizePhone(value) ?? value) : value,
    ),
    ValidateBy(
      {
        name: IS_UZ_PHONE,
        constraints: [options.allowDemo === true],
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' &&
            normalizePhone(value) === value &&
            (options.allowDemo === true || !isDemoPhone(value)),
          defaultMessage: () =>
            'Telefon raqami +998XXXXXXXXX formatida bo‘lishi kerak',
        },
      },
      validationOptions,
    ),
  );
}
