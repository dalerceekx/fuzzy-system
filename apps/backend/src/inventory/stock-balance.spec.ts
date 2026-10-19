import { Prisma } from '../generated/prisma/client.js';
import { StockMovementType } from '../generated/prisma/enums.js';
import { isNegativeStockViolation } from './inventory.errors.js';
import { applyMovement, decimalString, isAdjustment } from './stock-balance.js';

const balanceOf = (result: ReturnType<typeof applyMovement>) =>
  result.ok ? result.balance.toFixed(3) : result.reason;

describe('applyMovement', () => {
  it('adds inbound and subtracts outbound quantities exactly', () => {
    expect(
      balanceOf(applyMovement('0.100', StockMovementType.IN, '0.200')),
    ).toBe('0.300');
    expect(
      balanceOf(
        applyMovement('10.000', StockMovementType.ADJUSTMENT_IN, '0.001'),
      ),
    ).toBe('10.001');
    expect(balanceOf(applyMovement('0.3', StockMovementType.OUT, '0.1'))).toBe(
      '0.200',
    );
    expect(
      balanceOf(applyMovement('5', StockMovementType.ADJUSTMENT_OUT, '5')),
    ).toBe('0.000');
  });

  it('refuses to go below zero', () => {
    expect(applyMovement('1.000', StockMovementType.OUT, '1.001')).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
    });
    expect(
      applyMovement('0', StockMovementType.ADJUSTMENT_OUT, '0.001'),
    ).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK' });
  });

  it('refuses balances the Decimal(14, 3) column cannot hold', () => {
    expect(
      applyMovement('99999999999.999', StockMovementType.IN, '0.001'),
    ).toEqual({ ok: false, reason: 'STOCK_LIMIT_EXCEEDED' });
    expect(
      balanceOf(
        applyMovement('99999999999.998', StockMovementType.IN, '0.001'),
      ),
    ).toBe('99999999999.999');
  });

  it('keeps precision beyond IEEE-754 doubles', () => {
    // 12345678901.123 + 0.001 is not representable exactly as a JS number.
    expect(
      balanceOf(
        applyMovement('12345678901.123', StockMovementType.IN, '0.001'),
      ),
    ).toBe('12345678901.124');
  });
});

describe('helpers', () => {
  it('isAdjustment', () => {
    expect(isAdjustment(StockMovementType.ADJUSTMENT_IN)).toBe(true);
    expect(isAdjustment(StockMovementType.ADJUSTMENT_OUT)).toBe(true);
    expect(isAdjustment(StockMovementType.IN)).toBe(false);
    expect(isAdjustment(StockMovementType.OUT)).toBe(false);
  });

  it('decimalString uses a fixed scale and never exponent notation', () => {
    expect(decimalString(new Prisma.Decimal('1e-3'), 3)).toBe('0.001');
    expect(decimalString('10', 3)).toBe('10.000');
    expect(decimalString(new Prisma.Decimal('99999999999.999'), 3)).toBe(
      '99999999999.999',
    );
  });
});

describe('isNegativeStockViolation', () => {
  const adapterError = (sqlState: string, constraint: string) => ({
    name: 'DriverAdapterError',
    cause: {
      originalCode: sqlState,
      originalMessage: `new row for relation "x" violates check constraint "${constraint}"`,
    },
  });

  it('matches the non-negative stock constraints', () => {
    expect(
      isNegativeStockViolation(
        adapterError('23514', 'inventory_items_quantity_non_negative_chk'),
      ),
    ).toBe(true);
    expect(
      isNegativeStockViolation(
        adapterError('23514', 'stock_movements_balance_non_negative_chk'),
      ),
    ).toBe(true);
  });

  it('ignores other errors', () => {
    expect(
      isNegativeStockViolation(
        adapterError('23514', 'inventory_items_name_chk'),
      ),
    ).toBe(false);
    expect(
      isNegativeStockViolation(
        adapterError('23505', 'inventory_items_quantity_non_negative_chk'),
      ),
    ).toBe(false);
    expect(isNegativeStockViolation(new Error('boom'))).toBe(false);
  });
});
