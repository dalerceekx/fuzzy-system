import { Transform } from 'class-transformer';
import { sanitizeText } from '../strings.js';

/**
 * Applies `sanitizeText` (trim, NFC, strip control characters) before
 * validation. Combine with `@IsString()` and `@MaxLength(n)` (the length is
 * checked on the sanitized value).
 */
export function SanitizedText(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeText(value) : value,
  );
}
