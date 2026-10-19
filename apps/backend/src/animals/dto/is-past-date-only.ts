import { ValidateBy } from 'class-validator';
import { isValidDateOnly, todayInTashkent } from '../../common/time.js';

export const MIN_BIRTH_DATE = '1950-01-01';

/**
 * A real calendar date as 'YYYY-MM-DD' between `MIN_BIRTH_DATE` and today in
 * Asia/Tashkent (the business calendar), so a date that is already "today"
 * in Tashkent is accepted even while UTC is still on the previous day.
 */
export function isPastDateOnly(
  value: unknown,
  now: Date = new Date(),
): value is string {
  return (
    typeof value === 'string' &&
    value.length === 10 &&
    isValidDateOnly(value) &&
    value >= MIN_BIRTH_DATE &&
    value <= todayInTashkent(now)
  );
}

export function IsPastDateOnly(): PropertyDecorator {
  return ValidateBy({
    name: 'isPastDateOnly',
    validator: {
      validate: (value: unknown) => isPastDateOnly(value),
      defaultMessage: () =>
        '$property YYYY-MM-DD formatidagi sana bo‘lishi va kelajakda bo‘lmasligi kerak',
    },
  });
}
