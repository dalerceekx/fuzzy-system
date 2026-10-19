import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { sanitizeText } from '../../common/strings.js';

/**
 * Optional field that may be omitted but never sent as `null` (unlike
 * @IsOptional, which also skips validation for null).
 */
export function OptionalField(): PropertyDecorator {
  return ValidateIf((_dto, value) => value !== undefined);
}

/** Optional field where an explicit `null` clears the stored value. */
export function NullableField(): PropertyDecorator {
  return ValidateIf((_dto, value) => value !== undefined && value !== null);
}

/**
 * Boolean query-string flag: only the exact strings 'true' / 'false' are
 * accepted (implicit conversion is disabled globally, so anything else stays a
 * string and fails @IsBoolean). Combine with @IsOptional().
 */
export function QueryBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      value === 'true' ? true : value === 'false' ? false : value,
    ),
    IsBoolean(),
  );
}

// Unicode format characters (zero-width spaces/joiners, bidi overrides, BOM):
// invisible, so they can make a required field look empty or visually spoof
// names and reasons shown in admin/audit views.
const FORMAT_CHARS = /\p{Cf}/gu;

/**
 * Free text: `sanitizeText` (trim, NFC, control characters) plus removal of
 * invisible format characters. Combine with @IsString() and @MaxLength(n).
 */
export function CleanText(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? sanitizeText(value.replace(FORMAT_CHARS, ''))
      : value,
  );
}

/**
 * Identifier text (ear tags): like @CleanText, but NFKC-folded (fullwidth and
 * compatibility forms become ASCII) and with ASCII letters upper-cased, so
 * case variants hit the same unique index. Pair with an ASCII-only pattern so
 * Latin/Cyrillic look-alikes are rejected instead of stored as distinct tags.
 */
export function CanonicalCode(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? sanitizeText(value.normalize('NFKC').replace(FORMAT_CHARS, '')).replace(
          /[a-z]+/g,
          (s) => s.toUpperCase(),
        )
      : value,
  );
}
