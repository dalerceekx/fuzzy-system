import { plainToInstance } from 'class-transformer';
import { CanonicalCode, CleanText } from './field-decorators.js';

class Sample {
  @CleanText()
  text?: unknown;

  @CanonicalCode()
  code?: unknown;
}

const transform = (plain: object) => plainToInstance(Sample, plain);

describe('CleanText', () => {
  it.each([
    ['​‍﻿', ''],
    ['‮abc‬', 'abc'],
    ['  Oq​soy\u0007 ', 'Oqsoy'],
    ['⁦Jizzax⁩‎', 'Jizzax'],
    ['Sog‘lom', 'Sog‘lom'],
  ])('cleans %j to %j', (input, expected) => {
    expect(transform({ text: input }).text).toBe(expected);
  });

  it('leaves non-strings for the validators to reject', () => {
    expect(transform({ text: 42 }).text).toBe(42);
    expect(transform({ text: null }).text).toBeNull();
  });
});

describe('CanonicalCode', () => {
  it.each([
    [' ab-12 ', 'AB-12'],
    ['ＡＢ－１２', 'AB-12'], // fullwidth
    ['‎ab​-1', 'AB-1'],
    ['АВ-1', 'АВ-1'], // Cyrillic stays (pattern rejects it)
  ])('canonicalizes %j to %j', (input, expected) => {
    expect(transform({ code: input }).code).toBe(expected);
  });
});
