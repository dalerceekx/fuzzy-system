import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsPasswordPolicy, passwordContainsPhone } from './password-policy.js';

class Probe {
  @IsPasswordPolicy()
  password: string;
}

const errorsFor = (password: unknown) =>
  validateSync(plainToInstance(Probe, { password })).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('password policy', () => {
  it('accepts 8–128 characters with a letter and a digit', () => {
    for (const ok of [
      'abcdefg1',
      'Parol-2026',
      'ўзбек123',
      `a1${'x'.repeat(126)}`,
    ]) {
      expect(errorsFor(ok)).toEqual([]);
    }
  });

  it('rejects short, long, letter-less, digit-less and non-string values', () => {
    for (const bad of [
      'abc1',
      `a1${'x'.repeat(127)}`,
      '12345678',
      'abcdefgh',
      12345678,
      null,
    ]) {
      expect(errorsFor(bad).length).toBeGreaterThan(0);
    }
  });
});

describe('passwordContainsPhone', () => {
  const phone = '+998901234567';

  it('detects the phone number in any common spelling', () => {
    for (const bad of [
      '901234567',
      '998901234567',
      '+998901234567',
      '+998 90 123 45 67',
      '(90) 123-45-67',
      'a901234567',
      'parol901234567!',
    ]) {
      expect(passwordContainsPhone(bad, phone)).toBe(true);
    }
  });

  it('allows unrelated passwords', () => {
    for (const ok of ['Parol-2026', 'a90123456', '901234568x']) {
      expect(passwordContainsPhone(ok, phone)).toBe(false);
    }
  });
});
