import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListDiseasesQueryDto } from './list-diseases-query.dto.js';

function errors(plain: object): string[] {
  const dto = plainToInstance(ListDiseasesQueryDto, plain);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }).map((e) => e.property);
}

describe('ListDiseasesQueryDto', () => {
  it('accepts no filter and every filter combined', () => {
    expect(errors({})).toEqual([]);
    expect(errors({ animal: 'LAMB', groupNumber: '4', q: 'qo‘zi' })).toEqual(
      [],
    );
    for (const animal of ['CATTLE', 'CALF', 'SHEEP', 'LAMB']) {
      expect(errors({ animal })).toEqual([]);
    }
  });

  it('parses groupNumber from the query string', () => {
    const dto = plainToInstance(ListDiseasesQueryDto, { groupNumber: '2' });
    expect(dto.groupNumber).toBe(2);
  });

  it('sanitizes q and bounds it at 100 characters', () => {
    const dto = plainToInstance(ListDiseasesQueryDto, { q: '  gadir  ' });
    expect(dto.q).toBe('gadir');
    expect(errors({ q: 'x'.repeat(100) })).toEqual([]);
    expect(errors({ q: 'x'.repeat(101) })).toContain('q');
  });

  it.each([
    ['animal', 'DOG'],
    ['animal', 'cattle'],
    ['animal', ['CATTLE', 'SHEEP']],
    ['groupNumber', '0'],
    ['groupNumber', '5'],
    ['groupNumber', '1.5'],
    ['groupNumber', 'abc'],
    ['groupNumber', ''],
    ['q', ['a', 'b']],
    ['diagnosis', 'x'],
    ['dose', '1'],
  ])('rejects %s = %j', (field, value) => {
    expect(errors({ [field]: value })).toContain(field);
  });
});
