import { likeLiteral } from './vet-db.js';

describe('likeLiteral', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(likeLiteral('mastit')).toBe('mastit');
    expect(likeLiteral('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(likeLiteral('%%')).toBe('\\%\\%');
  });
});
