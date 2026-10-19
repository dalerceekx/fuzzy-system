import { globSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IsString, MaxLength, getMetadataStorage } from 'class-validator';

/**
 * Every string property of every DTO must be length-bounded: the scan
 * imports all DTO files (src/**\/dto/*.ts and src/**\/*.dto.ts) and checks
 * class-validator metadata — @IsString() without @MaxLength()/@Length(…, max)
 * fails the build.
 */

interface ValidationMeta {
  target: unknown;
  propertyName: string;
  name?: string;
  constraints?: unknown[];
  each?: boolean;
}

const ROOT = join(import.meta.dirname, '..', '..');

function allValidationMetadata(): ValidationMeta[] {
  // class-validator keeps metadata in a private Map keyed by class.
  const storage = getMetadataStorage() as unknown as {
    validationMetadatas: Map<unknown, ValidationMeta[]>;
  };
  return [...storage.validationMetadatas.values()].flat();
}

function isBounded(meta: ValidationMeta): boolean {
  if (meta.name === 'maxLength') return true;
  return meta.name === 'isLength' && typeof meta.constraints?.[1] === 'number';
}

/** "Class.property" for every string property without a length bound. */
function unboundedStringProperties(exclude: readonly unknown[] = []): string[] {
  const byProperty = new Map<string, ValidationMeta[]>();
  for (const meta of allValidationMetadata()) {
    if (typeof meta.target !== 'function' || exclude.includes(meta.target))
      continue;
    const key = `${(meta.target as { name: string }).name}.${meta.propertyName}`;
    byProperty.set(key, [...(byProperty.get(key) ?? []), meta]);
  }
  const offenders: string[] = [];
  for (const [key, metas] of byProperty) {
    for (const stringCheck of metas.filter(
      (meta) => meta.name === 'isString',
    )) {
      const bounded = metas.some(
        (meta) =>
          isBounded(meta) && Boolean(meta.each) === Boolean(stringCheck.each),
      );
      if (!bounded) offenders.push(key);
    }
  }
  return offenders;
}

describe('DTO string properties have a maximum length', () => {
  const files = [
    ...globSync('src/**/dto/*.ts', { cwd: ROOT }),
    ...globSync('src/**/*.dto.ts', { cwd: ROOT }),
  ].filter(
    (file, index, all) =>
      !file.endsWith('.spec.ts') && all.indexOf(file) === index,
  );

  beforeAll(async () => {
    for (const file of files)
      await import(pathToFileURL(join(ROOT, file)).href);
  });

  it('finds DTO files to scan', () => {
    expect(files.map((file) => relative(ROOT, join(ROOT, file)))).toContain(
      join('src', 'common', 'pagination', 'pagination-query.dto.ts'),
    );
  });

  it('every @IsString() property also has @MaxLength() (or @Length with a max)', () => {
    expect(unboundedStringProperties([SelfCheckDto, SelfCheckEachDto])).toEqual(
      [],
    );
  });

  it('self-check: the scan reports unbounded properties', () => {
    const offenders = unboundedStringProperties();
    expect(offenders).toEqual(
      expect.arrayContaining([
        'SelfCheckDto.unbounded',
        'SelfCheckEachDto.tags',
      ]),
    );
    expect(offenders).not.toContain('SelfCheckDto.bounded');
  });
});

class SelfCheckDto {
  @IsString()
  unbounded: string;

  @IsString()
  @MaxLength(10)
  bounded: string;
}

class SelfCheckEachDto {
  @IsString({ each: true })
  @MaxLength(10)
  tags: string[];
}
