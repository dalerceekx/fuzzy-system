import { plainToInstance } from 'class-transformer';
import { IsString, MaxLength, validateSync } from 'class-validator';
import {
  IsAcceptablePassword,
  passwordPolicyError,
} from './password-policy.js';

describe('passwordPolicyError', () => {
  it.each(['Parol1234', 'abcdefg1', 'Ўзбек-сўз-2026', `a1${'x'.repeat(126)}`])(
    'accepts %s',
    (password) => {
      expect(passwordPolicyError(password)).toBeNull();
    },
  );

  it.each([
    ['too short', 'abc1234'],
    ['too long', `a1${'x'.repeat(127)}`],
    ['no digit', 'only-letters'],
    ['no letter', '1234567890'],
  ])('rejects a password that is %s', (_name, password) => {
    expect(passwordPolicyError(password)).toEqual(expect.any(String));
  });

  it('rejects the phone number itself', () => {
    const phone = '+998901234567';
    for (const password of [phone, '998901234567', '901234567']) {
      expect(passwordPolicyError(password, phone)).toEqual(expect.any(String));
    }
  });
});

describe('@IsAcceptablePassword', () => {
  class Dto {
    @IsString()
    @MaxLength(32)
    phone: string;

    @IsAcceptablePassword()
    password: unknown;
  }

  const errors = (body: object) =>
    validateSync(plainToInstance(Dto, body)).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );

  it('passes a valid password and explains a rejected one in Uzbek', () => {
    expect(errors({ phone: '+998901234567', password: 'Parol1234' })).toEqual(
      [],
    );
    expect(errors({ phone: '+998901234567', password: 'short1' })).toEqual([
      'Parol 8–128 belgidan iborat bo‘lishi kerak',
    ]);
  });

  it('rejects non-string values', () => {
    expect(errors({ phone: '+998901234567', password: 12345678 })).toHaveLength(
      1,
    );
  });
});
