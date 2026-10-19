import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateStockMovementDto } from './create-movement.dto.js';
import { CreateInventoryItemDto } from './create-item.dto.js';
import { ListInventoryItemsQueryDto } from './list-items-query.dto.js';
import { UpdateInventoryItemDto } from './update-item.dto.js';

function errors<T extends object>(cls: new () => T, plain: object): string[] {
  const dto = plainToInstance(cls, plain);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }).map((e) => e.property);
}

describe('CreateStockMovementDto', () => {
  const ok = { type: 'IN', quantity: '1.5' };

  it('accepts decimal strings within limits', () => {
    expect(errors(CreateStockMovementDto, ok)).toEqual([]);
    expect(
      errors(CreateStockMovementDto, { ...ok, quantity: '99999999999.999' }),
    ).toEqual([]);
    expect(
      errors(CreateStockMovementDto, {
        ...ok,
        unitCost: '0',
        currency: 'UZS',
      }),
    ).toEqual([]);
  });

  it.each([
    1,
    1.5,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    'NaN',
    'Infinity',
    '1e2',
    '-1',
    '0',
    '0.000',
    '+1',
    '.5',
    '1.',
    '1.0001',
    '01',
    ' 1',
    '1,5',
    '100000000000',
    '',
    true,
    {},
    ['1'],
  ])('rejects quantity %j', (quantity) => {
    expect(errors(CreateStockMovementDto, { ...ok, quantity })).toContain(
      'quantity',
    );
  });

  it('requires unitCost and currency together', () => {
    expect(
      errors(CreateStockMovementDto, { ...ok, unitCost: '1.00' }),
    ).toContain('currency');
    expect(
      errors(CreateStockMovementDto, { ...ok, currency: 'UZS' }),
    ).toContain('unitCost');
    expect(
      errors(CreateStockMovementDto, {
        ...ok,
        unitCost: '1.001',
        currency: 'UZS',
      }),
    ).toContain('unitCost');
    expect(
      errors(CreateStockMovementDto, {
        ...ok,
        unitCost: '1',
        currency: 'uzs',
      }),
    ).toContain('currency');
    expect(
      errors(CreateStockMovementDto, { ...ok, unitCost: null, currency: null }),
    ).toEqual(expect.arrayContaining(['unitCost', 'currency']));
  });

  it('requires a reason for adjustments only', () => {
    expect(
      errors(CreateStockMovementDto, { type: 'ADJUSTMENT_OUT', quantity: '1' }),
    ).toContain('reason');
    expect(
      errors(CreateStockMovementDto, {
        type: 'ADJUSTMENT_IN',
        quantity: '1',
        reason: '   ',
      }),
    ).toContain('reason');
    expect(
      errors(CreateStockMovementDto, {
        type: 'ADJUSTMENT_IN',
        quantity: '1',
        reason: 'Inventarizatsiya',
      }),
    ).toEqual([]);
    expect(
      errors(CreateStockMovementDto, { ...ok, reason: 'x'.repeat(501) }),
    ).toContain('reason');
    expect(errors(CreateStockMovementDto, { ...ok, reason: null })).toContain(
      'reason',
    );
  });

  it('rejects unknown types and fields', () => {
    expect(
      errors(CreateStockMovementDto, { ...ok, type: 'TRANSFER' }),
    ).toContain('type');
    expect(
      errors(CreateStockMovementDto, { ...ok, balanceAfter: '100' }),
    ).toContain('balanceAfter');
  });
});

describe('CreateInventoryItemDto', () => {
  const ok = {
    farmId: '4b0e7f61-2b7e-4bb4-9a8e-6c1f9a1d2e3f',
    name: 'Yem',
    category: 'FEED',
    unit: 'KG',
  };

  it('accepts a minimal item', () => {
    expect(errors(CreateInventoryItemDto, ok)).toEqual([]);
  });

  it('never accepts a client-chosen quantity', () => {
    expect(errors(CreateInventoryItemDto, { ...ok, quantity: '5' })).toContain(
      'quantity',
    );
  });

  it.each([
    ['expiresOn', '2026-02-30'],
    ['expiresOn', '2026-1-01'],
    ['expiresOn', null],
    ['medicineId', 'not-a-uuid'],
    ['medicineId', null],
    ['useWithinDaysAfterOpening', 0],
    ['useWithinDaysAfterOpening', '7'],
    ['batchNumber', 'x'.repeat(65)],
    ['name', '   '],
    ['name', 'x'.repeat(121)],
    ['category', 'WEAPON'],
  ])('rejects %s = %j', (field, value) => {
    expect(errors(CreateInventoryItemDto, { ...ok, [field]: value })).toContain(
      field,
    );
  });

  it('accepts a price, a low-stock threshold and an initial quantity', () => {
    expect(
      errors(CreateInventoryItemDto, {
        ...ok,
        unitPrice: '3500.00',
        minQuantity: '0',
        initialQuantity: '500',
      }),
    ).toEqual([]);
    expect(
      errors(CreateInventoryItemDto, {
        ...ok,
        unitPrice: '0',
        minQuantity: '99999999999.999',
        initialQuantity: '0.001',
      }),
    ).toEqual([]);
    expect(
      errors(CreateInventoryItemDto, {
        ...ok,
        unitPrice: '99999999999999.99',
      }),
    ).toEqual([]);
  });

  it.each([
    ['unitPrice', 3500],
    ['unitPrice', '-1'],
    ['unitPrice', '1.001'],
    ['unitPrice', '100000000000000'],
    ['unitPrice', '1e3'],
    ['unitPrice', null],
    ['minQuantity', '-0.001'],
    ['minQuantity', '1.0001'],
    ['minQuantity', '100000000000'],
    ['minQuantity', 5],
    ['minQuantity', null],
    ['initialQuantity', '0'],
    ['initialQuantity', '0.000'],
    ['initialQuantity', '-5'],
    ['initialQuantity', '1.0001'],
    ['initialQuantity', '100000000000'],
    ['initialQuantity', 10],
    ['initialQuantity', null],
  ])('rejects %s = %j', (field, value) => {
    expect(errors(CreateInventoryItemDto, { ...ok, [field]: value })).toContain(
      field,
    );
  });
});

describe('UpdateInventoryItemDto', () => {
  it('allows null to clear optional metadata but not the name', () => {
    expect(
      errors(UpdateInventoryItemDto, {
        batchNumber: null,
        expiresOn: null,
        useWithinDaysAfterOpening: null,
      }),
    ).toEqual([]);
    expect(errors(UpdateInventoryItemDto, { name: null })).toContain('name');
  });

  it('rejects quantity and ownership fields', () => {
    for (const field of [
      'quantity',
      'initialQuantity',
      'farmId',
      'category',
      'unit',
      'medicineId',
    ]) {
      expect(errors(UpdateInventoryItemDto, { [field]: 'x' })).toContain(field);
    }
  });

  it('sets or clears the price and the low-stock threshold', () => {
    expect(
      errors(UpdateInventoryItemDto, {
        unitPrice: '2800.5',
        minQuantity: '50',
      }),
    ).toEqual([]);
    expect(
      errors(UpdateInventoryItemDto, { unitPrice: null, minQuantity: null }),
    ).toEqual([]);
    for (const [field, value] of [
      ['unitPrice', '-1'],
      ['unitPrice', 2800],
      ['unitPrice', '0.001'],
      ['minQuantity', '-1'],
      ['minQuantity', '0.0001'],
      ['minQuantity', 50],
    ] as const) {
      expect(errors(UpdateInventoryItemDto, { [field]: value })).toContain(
        field,
      );
    }
  });
});

describe('ListInventoryItemsQueryDto', () => {
  it('parses query-string booleans strictly', () => {
    const dto = plainToInstance(ListInventoryItemsQueryDto, {
      includeArchived: 'true',
    });
    expect(dto.includeArchived).toBe(true);
    expect(validateSync(dto)).toEqual([]);
    expect(
      errors(ListInventoryItemsQueryDto, { includeArchived: '1' }),
    ).toContain('includeArchived');
  });

  it('allows only allowlisted sort fields', () => {
    expect(errors(ListInventoryItemsQueryDto, { sort: '-expiresOn' })).toEqual(
      [],
    );
    expect(errors(ListInventoryItemsQueryDto, { sort: 'quantity' })).toContain(
      'sort',
    );
  });
});
