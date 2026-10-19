import { mapDatabaseError } from '../common/errors/all-exceptions.filter.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  dbErrorInfo,
  isCheckViolation,
  isDatabaseError,
  isForeignKeyViolation,
  isNotFoundError,
  isSerializationFailure,
  isUniqueViolation,
} from './db-errors.js';

const ROW_DETAIL = 'Failing row contains (…, scrypt$secret-hash, …)';

function knownError(
  code: string,
  cause?: Record<string, unknown>,
  modelName = 'User',
) {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid invocation… ${ROW_DETAIL}`,
    {
      code,
      clientVersion: '7.10.1',
      meta: {
        modelName,
        ...(cause
          ? {
              driverAdapterError: Object.assign(new Error('adapter'), {
                name: 'DriverAdapterError',
                cause,
              }),
            }
          : {}),
      },
    },
  );
}

/** Shape of a deferred-trigger failure at COMMIT of an interactive tx. */
function bareAdapterError(cause: Record<string, unknown>) {
  return Object.assign(
    new Error('at least one active SUPER_ADMIN must remain'),
    { name: 'DriverAdapterError', cause },
  );
}

describe('dbErrorInfo', () => {
  it('reads unique violations (P2002 / 23505) with the index name', () => {
    const err = knownError('P2002', {
      originalCode: '23505',
      originalMessage:
        'duplicate key value violates unique constraint "users_phone_key"',
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_phone_key' },
    });
    expect(dbErrorInfo(err)).toStrictEqual({
      prismaCode: 'P2002',
      model: 'User',
      sqlState: '23505',
      constraint: 'users_phone_key',
    });
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, 'users_phone_key')).toBe(true);
    expect(isUniqueViolation(err, 'other_key')).toBe(false);
  });

  it('extracts only the constraint name of a check violation (P2039 / 23514)', () => {
    const err = knownError('P2039', {
      originalCode: '23514',
      originalMessage:
        'new row for relation "inventory_items" violates check constraint "inventory_items_quantity_non_negative_chk"',
      kind: 'postgres',
      detail: ROW_DETAIL,
    });
    const info = dbErrorInfo(err);
    expect(info).toStrictEqual({
      prismaCode: 'P2039',
      model: 'User',
      sqlState: '23514',
      constraint: 'inventory_items_quantity_non_negative_chk',
    });
    expect(JSON.stringify(info)).not.toContain('secret-hash');
    expect(
      isCheckViolation(err, 'inventory_items_quantity_non_negative_chk'),
    ).toBe(true);
    expect(isCheckViolation(err, 'something_else')).toBe(false);
  });

  it('handles raw-query errors (P2010) and trigger-raised SQLSTATEs', () => {
    const appendOnly = knownError('P2010', {
      originalCode: '42501',
      originalMessage: 'audit_logs is append-only',
      kind: 'postgres',
    });
    expect(dbErrorInfo(appendOnly)).toMatchObject({
      prismaCode: 'P2010',
      sqlState: '42501',
    });
    const fk = knownError('P2003', {
      originalCode: '23503',
      kind: 'ForeignKeyConstraintViolation',
    });
    expect(isForeignKeyViolation(fk)).toBe(true);
  });

  it('handles a bare DriverAdapterError (deferred constraint at commit)', () => {
    const err = bareAdapterError({
      originalCode: '23514',
      originalMessage: 'at least one active SUPER_ADMIN must remain',
      kind: 'postgres',
    });
    expect(isDatabaseError(err)).toBe(true);
    expect(dbErrorInfo(err)).toStrictEqual({ sqlState: '23514' });
    expect(isCheckViolation(err)).toBe(true);
  });

  it('recognizes not-found and serialization failures', () => {
    expect(isNotFoundError(knownError('P2025'))).toBe(true);
    expect(
      isSerializationFailure(
        knownError('P2034', {
          originalCode: '40001',
          kind: 'TransactionWriteConflict',
        }),
      ),
    ).toBe(true);
    expect(
      isSerializationFailure(bareAdapterError({ originalCode: '40P01' })),
    ).toBe(true);
  });

  it('reads plain node-postgres errors and ignores everything else', () => {
    expect(
      dbErrorInfo(
        Object.assign(new Error('x'), {
          code: '23505',
          severity: 'ERROR',
          constraint: 'k',
        }),
      ),
    ).toStrictEqual({
      sqlState: '23505',
      constraint: 'k',
    });
    expect(dbErrorInfo(new Error('plain'))).toBeNull();
    expect(
      dbErrorInfo(Object.assign(new Error('fs'), { code: 'ENOENT' })),
    ).toBeNull();
    expect(dbErrorInfo(null)).toBeNull();
    expect(dbErrorInfo('string')).toBeNull();
  });
});

describe('mapDatabaseError', () => {
  it.each([
    [{ prismaCode: 'P2002', sqlState: '23505' }, 409, 'CONFLICT'],
    [{ sqlState: '23505' }, 409, 'CONFLICT'],
    [{ prismaCode: 'P2003' }, 409, 'CONFLICT'],
    [{ sqlState: '23514' }, 409, 'CONSTRAINT_VIOLATION'],
    [{ sqlState: '42501' }, 409, 'CONSTRAINT_VIOLATION'],
    [{ sqlState: '40001' }, 409, 'RETRY'],
    [{ sqlState: '40P01' }, 409, 'RETRY'],
    [{ prismaCode: 'P2034' }, 409, 'RETRY'],
    [{ prismaCode: 'P2025' }, 404, 'NOT_FOUND'],
    [{ sqlState: '22P02', prismaCode: 'P2010' }, 500, 'INTERNAL_ERROR'],
    [{ prismaCode: 'P1001' }, 500, 'INTERNAL_ERROR'],
  ])('%o → %i %s', (info, status, code) => {
    expect(mapDatabaseError(info)).toMatchObject({ statusCode: status, code });
  });
});
