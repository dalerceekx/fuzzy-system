import { plainToInstance } from 'class-transformer';
import { IsOptional, validateSync } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginated,
  PaginationQueryDto,
  toSkipTake,
} from './pagination-query.dto.js';
import { buildOrderBy, IsSortParam } from './sort.js';

class ListQuery extends PaginationQueryDto {
  @IsOptional()
  @IsSortParam(['createdAt', 'name'])
  sort?: string;
}

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListQuery, query);
  return {
    dto,
    errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('PaginationQueryDto', () => {
  it('defaults page and limit when omitted', () => {
    const { dto, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it('converts numeric query strings explicitly', () => {
    const { dto, errors } = parse({ page: '3', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 3, limit: 50 });
    expect(toSkipTake(dto)).toEqual({ skip: 100, take: 50 });
  });

  it.each([
    { limit: String(MAX_PAGE_SIZE + 1) },
    { limit: '0' },
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { limit: '' },
    { page: ['1', '2'] },
    { page: '10001' },
  ])('rejects %o', (query) => {
    expect(parse(query).errors).not.toHaveLength(0);
  });

  it('toSkipTake clamps values that bypassed validation', () => {
    expect(toSkipTake({ page: 0, limit: 1000 } as PaginationQueryDto)).toEqual({
      skip: 0,
      take: MAX_PAGE_SIZE,
    });
    expect(
      toSkipTake({ page: Number.NaN, limit: Number.NaN } as PaginationQueryDto),
    ).toEqual({ skip: 0, take: DEFAULT_PAGE_SIZE });
  });

  it('paginated builds the response envelope', () => {
    expect(paginated(['a'], 41, { page: 3, limit: 20 })).toEqual({
      items: ['a'],
      page: 3,
      limit: 20,
      total: 41,
    });
  });
});

describe('sorting', () => {
  it('IsSortParam accepts allowlisted fields with an optional "-" prefix', () => {
    expect(parse({ sort: 'name' }).errors).toHaveLength(0);
    expect(parse({ sort: '-createdAt' }).errors).toHaveLength(0);
  });

  it.each([
    'password',
    'name;DROP',
    '--name',
    'name desc',
    '{"name":"asc"}',
    '__proto__',
    'x'.repeat(80),
  ])('IsSortParam rejects %s', (sort) => {
    expect(parse({ sort }).errors).not.toHaveLength(0);
  });

  const mapping = {
    createdAt: (dir: 'asc' | 'desc') => ({ createdAt: dir }),
    name: (dir: 'asc' | 'desc') => ({ name: dir }),
  };
  const fallback = { createdAt: 'desc' };

  it('buildOrderBy maps a key to static code only', () => {
    expect(buildOrderBy('name', mapping, fallback)).toEqual([{ name: 'asc' }]);
    expect(buildOrderBy('-createdAt', mapping, fallback)).toEqual([
      { createdAt: 'desc' },
    ]);
    expect(buildOrderBy(undefined, mapping, fallback)).toEqual([fallback]);
  });

  it('buildOrderBy ignores unknown and prototype keys', () => {
    for (const sort of ['password', '-__proto__', 'constructor', 'toString']) {
      expect(buildOrderBy(sort, mapping, fallback)).toEqual([fallback]);
    }
  });
});
