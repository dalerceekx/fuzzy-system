import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * Boolean query-string flag: only the exact strings 'true' / 'false' are
 * accepted (implicit conversion is disabled globally, so anything else stays
 * a string and fails @IsBoolean). Combine with @IsOptional().
 */
export function QueryBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      value === 'true' ? true : value === 'false' ? false : value,
    ),
    IsBoolean(),
  );
}
