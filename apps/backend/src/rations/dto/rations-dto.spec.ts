import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateRationAnimalTypeDto,
  ListRationAnimalTypesQueryDto,
} from './animal-type.dto.js';
import { IssueRationDto, ListRationIssuesQueryDto } from './issue.dto.js';
import {
  CopyRationDto,
  CreateRationDto,
  ListRationsQueryDto,
  UpdateRationDto,
} from './ration.dto.js';

function errors<T extends object>(cls: new () => T, plain: object): string[] {
  const dto = plainToInstance(cls, plain);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }).map((e) => e.property);
}

const FARM = '4b0e7f61-2b7e-4bb4-9a8e-6c1f9a1d2e3f';
const TYPE = '9d3c2b1a-5e4f-4a7b-8c9d-0e1f2a3b4c5d';
const ITEM = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ITEM_2 = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

describe('CreateRationAnimalTypeDto', () => {
  const ok = { farmId: FARM, name: 'Buzoq', species: 'CATTLE' };

  it('accepts a minimal type and every profile/sex', () => {
    expect(errors(CreateRationAnimalTypeDto, ok)).toEqual([]);
    expect(
      errors(CreateRationAnimalTypeDto, {
        ...ok,
        profile: 'COW',
        sex: 'FEMALE',
      }),
    ).toEqual([]);
    expect(errors(CreateRationAnimalTypeDto, { ...ok, sex: null })).toEqual([]);
  });

  it('sanitizes the name before checking its length', () => {
    const dto = plainToInstance(CreateRationAnimalTypeDto, {
      ...ok,
      name: `  ${'x'.repeat(60)}  `,
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.name).toBe('x'.repeat(60));
  });

  it.each([
    ['name', ''],
    ['name', '   '],
    ['name', 'x'.repeat(61)],
    ['name', 5],
    ['species', 'DRAGON'],
    ['species', undefined],
    ['profile', 'CALF'],
    ['profile', null],
    ['sex', 'UNKNOWN'],
    ['sex', 'male'],
    ['farmId', 'not-a-uuid'],
    ['isDefault', true],
  ])('rejects %s = %j', (field, value) => {
    expect(
      errors(CreateRationAnimalTypeDto, { ...ok, [field]: value }),
    ).toContain(field);
  });
});

describe('ListRationAnimalTypesQueryDto', () => {
  it('requires farmId and parses includeArchived strictly', () => {
    expect(errors(ListRationAnimalTypesQueryDto, {})).toContain('farmId');
    const dto = plainToInstance(ListRationAnimalTypesQueryDto, {
      farmId: FARM,
      includeArchived: 'true',
    });
    expect(dto.includeArchived).toBe(true);
    expect(validateSync(dto)).toEqual([]);
    expect(
      errors(ListRationAnimalTypesQueryDto, {
        farmId: FARM,
        includeArchived: '1',
      }),
    ).toContain('includeArchived');
    expect(
      errors(ListRationAnimalTypesQueryDto, { farmId: FARM, page: '1' }),
    ).toContain('page');
  });
});

describe('CreateRationDto', () => {
  const ok = {
    farmId: FARM,
    animalTypeId: TYPE,
    name: 'Semirtirish 1-bosqich',
    animalCount: 10,
    purpose: 'FATTENING',
    days: 30,
    items: [{ inventoryItemId: ITEM, dailyPerAnimal: '8' }],
  };

  it('accepts a minimal ration and every optional parameter', () => {
    expect(errors(CreateRationDto, ok)).toEqual([]);
    expect(
      errors(CreateRationDto, {
        ...ok,
        averageWeightKg: '450.5',
        ageMonths: 0,
        physiologicalState: 'PREGNANT',
        milkYieldLiters: '0',
        notes: '',
        items: [
          { inventoryItemId: ITEM, dailyPerAnimal: '999999.999' },
          { inventoryItemId: ITEM_2, dailyPerAnimal: '0.001' },
        ],
      }),
    ).toEqual([]);
    expect(
      errors(CreateRationDto, {
        ...ok,
        averageWeightKg: null,
        ageMonths: null,
        physiologicalState: null,
        milkYieldLiters: null,
        notes: null,
        animalCount: 1_000_000,
        days: 3650,
      }),
    ).toEqual([]);
  });

  it.each([
    ['farmId', undefined],
    ['animalTypeId', 'x'],
    ['name', ''],
    ['name', '  '],
    ['name', 'x'.repeat(101)],
    ['animalCount', 0],
    ['animalCount', 1_000_001],
    ['animalCount', 1.5],
    ['animalCount', '10'],
    ['averageWeightKg', '0'],
    ['averageWeightKg', '1000000'],
    ['averageWeightKg', '1.001'],
    ['averageWeightKg', 450],
    ['ageMonths', -1],
    ['ageMonths', 601],
    ['ageMonths', '18'],
    ['purpose', 'GROWTH'],
    ['purpose', null],
    ['physiologicalState', 'SICK'],
    ['milkYieldLiters', '-1'],
    ['milkYieldLiters', '10000'],
    ['milkYieldLiters', '1.234'],
    ['days', 0],
    ['days', 3651],
    ['days', null],
    ['notes', 'x'.repeat(501)],
    ['notes', 5],
    ['items', []],
    ['items', undefined],
    ['items', 'x'],
    ['archivedAt', null],
  ])('rejects %s = %j', (field, value) => {
    expect(errors(CreateRationDto, { ...ok, [field]: value })).toContain(field);
  });

  it('allows at most 20 items', () => {
    const items = (n: number) =>
      Array.from({ length: n }, () => ({
        inventoryItemId: ITEM,
        dailyPerAnimal: '1',
      }));
    expect(errors(CreateRationDto, { ...ok, items: items(20) })).toEqual([]);
    expect(errors(CreateRationDto, { ...ok, items: items(21) })).toContain(
      'items',
    );
  });

  it.each([
    { inventoryItemId: 'x', dailyPerAnimal: '1' },
    { inventoryItemId: ITEM, dailyPerAnimal: '0' },
    { inventoryItemId: ITEM, dailyPerAnimal: '1.0001' },
    { inventoryItemId: ITEM, dailyPerAnimal: '1000000' },
    { inventoryItemId: ITEM, dailyPerAnimal: 8 },
    { inventoryItemId: ITEM },
    { inventoryItemId: ITEM, dailyPerAnimal: '1', position: 3 },
    null,
    'x',
  ])('rejects the item %j', (item) => {
    expect(errors(CreateRationDto, { ...ok, items: [item] })).toContain(
      'items',
    );
  });
});

describe('UpdateRationDto', () => {
  it('accepts an empty or partial update and null clears', () => {
    expect(errors(UpdateRationDto, {})).toEqual([]);
    expect(
      errors(UpdateRationDto, {
        name: 'Yangi',
        averageWeightKg: null,
        ageMonths: null,
        physiologicalState: null,
        milkYieldLiters: null,
        notes: null,
        items: [{ inventoryItemId: ITEM, dailyPerAnimal: '2.5' }],
      }),
    ).toEqual([]);
  });

  it.each(['animalTypeId', 'name', 'animalCount', 'purpose', 'days', 'items'])(
    'refuses null for the required field %s',
    (field) => {
      expect(errors(UpdateRationDto, { [field]: null })).toContain(field);
    },
  );

  it('never moves a ration to another farm and needs ≥ 1 item', () => {
    expect(errors(UpdateRationDto, { farmId: FARM })).toContain('farmId');
    expect(errors(UpdateRationDto, { items: [] })).toContain('items');
  });
});

describe('CopyRationDto', () => {
  it('takes an optional new name only', () => {
    expect(errors(CopyRationDto, {})).toEqual([]);
    expect(errors(CopyRationDto, { name: 'Nusxa' })).toEqual([]);
    for (const name of ['', '  ', 'x'.repeat(101), null, 5]) {
      expect(errors(CopyRationDto, { name })).toContain('name');
    }
    expect(errors(CopyRationDto, { days: 5 })).toContain('days');
  });
});

describe('ListRationsQueryDto', () => {
  it('filters strictly and sorts by allowlisted fields only', () => {
    const dto = plainToInstance(ListRationsQueryDto, {
      farmId: FARM,
      animalTypeId: TYPE,
      includeArchived: 'false',
      sort: '-updatedAt',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.includeArchived).toBe(false);
    for (const sort of ['name', '-createdAt', 'updatedAt']) {
      expect(errors(ListRationsQueryDto, { sort })).toEqual([]);
    }
    expect(errors(ListRationsQueryDto, { sort: 'days' })).toContain('sort');
    expect(errors(ListRationsQueryDto, { farmId: 'x' })).toContain('farmId');
    expect(errors(ListRationsQueryDto, { includeArchived: 'yes' })).toContain(
      'includeArchived',
    );
    expect(errors(ListRationsQueryDto, { limit: '101' })).toContain('limit');
  });
});

describe('IssueRationDto', () => {
  it('takes whole days 1..3650', () => {
    expect(errors(IssueRationDto, { days: 1 })).toEqual([]);
    expect(errors(IssueRationDto, { days: 3650 })).toEqual([]);
    for (const days of [0, 3651, 1.5, '7', null, undefined]) {
      expect(errors(IssueRationDto, { days })).toContain('days');
    }
    expect(errors(IssueRationDto, { days: 1, animalCount: 5 })).toContain(
      'animalCount',
    );
  });
});

describe('ListRationIssuesQueryDto', () => {
  it('paginates and has no other parameters', () => {
    expect(errors(ListRationIssuesQueryDto, { page: '2', limit: '5' })).toEqual(
      [],
    );
    expect(errors(ListRationIssuesQueryDto, { sort: 'createdAt' })).toContain(
      'sort',
    );
  });
});
