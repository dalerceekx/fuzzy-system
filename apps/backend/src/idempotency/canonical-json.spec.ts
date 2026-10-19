import { Prisma } from '../generated/prisma/client.js';
import { canonicalHash, canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: true } })).toBe(
      '{"a":{"c":true,"d":[3,1]},"b":1}',
    );
    expect(canonicalHash({ x: 1, y: 2 })).toBe(canonicalHash({ y: 2, x: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it('normalizes special values deterministically', () => {
    expect(
      canonicalJson({
        quantity: new Prisma.Decimal('1.500'),
        at: new Date('2026-10-16T00:00:00.000Z'),
        big: 10n,
        missing: undefined,
        nil: null,
        nan: Number.NaN,
      }),
    ).toBe(
      '{"at":"2026-10-16T00:00:00.000Z","big":"10","nan":null,"nil":null,"quantity":"1.5"}',
    );
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('distinguishes different payloads', () => {
    expect(canonicalHash({ quantity: '1.5' })).not.toBe(
      canonicalHash({ quantity: '1.50' }),
    );
    expect(canonicalHash({ a: '1' })).not.toBe(canonicalHash({ a: 1 }));
    expect(canonicalHash({ itemId: 'x', body: { q: '1' } })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
