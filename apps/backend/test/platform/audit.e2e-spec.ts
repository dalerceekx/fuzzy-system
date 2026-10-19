import { randomUUID } from 'node:crypto';
import { AuditAction } from '../../src/audit/audit-actions.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { RequestContext } from '../../src/common/context/request-context.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { dbErrorInfo, isDatabaseError } from '../../src/prisma/db-errors.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';

describe('AuditService and the append-only audit log', () => {
  let testApp: TestApp;
  let audit: AuditService;

  beforeAll(async () => {
    testApp = await createTestApp();
    audit = testApp.app.get(AuditService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function recordOne(
    resourceId: string,
    extra: Partial<Parameters<AuditService['record']>[0]> = {},
  ) {
    await audit.record({
      action: AuditAction.USER_VIEWED,
      resourceType: 'user',
      resourceId,
      ...extra,
    });
    return testApp.prisma.auditLog.findFirstOrThrow({ where: { resourceId } });
  }

  it('fills actor, IP, user agent and request id from the request context', async () => {
    const { user } = await createUser(testApp.prisma, {
      role: UserRole.SUPPORT,
    });
    const resourceId = randomUUID();
    await RequestContext.run(
      {
        requestId: 'req-audit-0001',
        ip: '192.0.2.10',
        userAgent: 'audit-test',
        userId: user.id,
        role: UserRole.SUPPORT,
      },
      () =>
        audit.record({
          action: AuditAction.USER_VIEWED,
          resourceType: 'user',
          resourceId,
        }),
    );
    const row = await testApp.prisma.auditLog.findFirstOrThrow({
      where: { resourceId },
    });
    expect(row).toMatchObject({
      action: 'user.viewed',
      actorId: user.id,
      actorRole: UserRole.SUPPORT,
      ip: '192.0.2.10',
      userAgent: 'audit-test',
      requestId: 'req-audit-0001',
      oldValue: null,
      newValue: null,
    });
    expect(row.timestamp).toBeInstanceOf(Date);
  });

  it('records anonymous events with a null actor', async () => {
    const row = await recordOne(randomUUID());
    expect(row.actorId).toBeNull();
    expect(row.actorRole).toBeNull();
  });

  it('sanitizes values: secrets redacted at any depth, decimals and dates normalized', async () => {
    const resourceId = randomUUID();
    const row = await recordOne(resourceId, {
      oldValue: { role: 'FARMER', passwordHash: 'scrypt$1$2$3$aa$bb' },
      newValue: {
        password: 'P@ssw0rd-plain',
        nested: {
          refreshToken: 'rt.jwt.value',
          apiKey: 'sms-key',
          note: 'ok',
          deeper: { otp: '123456', code: '654321' },
        },
        quantity: new Prisma.Decimal('12.500'),
        at: new Date('2026-10-16T10:00:00.000Z'),
        list: Array.from({ length: 80 }, (_, i) => i),
        long: 'x'.repeat(2000),
      },
    });
    const stored = JSON.stringify([row.oldValue, row.newValue]);
    for (const secret of [
      'P@ssw0rd-plain',
      'rt.jwt.value',
      'sms-key',
      '123456',
      '654321',
      'scrypt$',
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(row.oldValue).toStrictEqual({
      role: 'FARMER',
      passwordHash: '[REDACTED]',
    });
    const value = row.newValue as Record<string, unknown>;
    expect(value.password).toBe('[REDACTED]');
    expect(value.nested).toMatchObject({
      refreshToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      note: 'ok',
      deeper: { otp: '[REDACTED]', code: '[REDACTED]' },
    });
    expect(value.quantity).toBe('12.5');
    expect(value.at).toBe('2026-10-16T10:00:00.000Z');
    expect(value.list).toHaveLength(50);
    expect((value.long as string).length).toBeLessThanOrEqual(501);
  });

  it('is atomic with the caller transaction', async () => {
    const resourceId = randomUUID();
    await expect(
      testApp.prisma.$transaction(async (tx) => {
        await audit.record(
          {
            action: AuditAction.USER_BLOCKED,
            resourceType: 'user',
            resourceId,
          },
          tx,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await testApp.prisma.auditLog.count({ where: { resourceId } })).toBe(
      0,
    );
  });

  /**
   * Asserts the rejection came from the reject_mutation() trigger itself,
   * not from a missing grant or any other failure (both use SQLSTATE 42501,
   * so the trigger's message is checked too).
   */
  function expectAppendOnlyRejection(error: unknown, operation: string): void {
    expect(isDatabaseError(error)).toBe(true);
    expect(dbErrorInfo(error)?.sqlState).toBe('42501');
    const meta = (error as { meta?: Record<string, unknown> }).meta;
    const cause = (
      meta?.driverAdapterError as { cause?: { originalMessage?: unknown } }
    )?.cause;
    const text = `${(error as Error).message} ${String(cause?.originalMessage)}`;
    expect(text).toContain(`audit_logs is append-only: ${operation} rejected`);
  }

  describe('append-only (database trigger)', () => {
    it('rejects UPDATE and leaves the row unchanged', async () => {
      const row = await recordOne(randomUUID());
      const error = await testApp.prisma.auditLog
        .update({ where: { id: row.id }, data: { action: 'user.blocked' } })
        .catch((err: unknown) => err);
      expectAppendOnlyRejection(error, 'UPDATE');
      expect(
        (
          await testApp.prisma.auditLog.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).action,
      ).toBe('user.viewed');
    });

    it('rejects DELETE', async () => {
      const row = await recordOne(randomUUID());
      expectAppendOnlyRejection(
        await testApp.prisma.auditLog
          .delete({ where: { id: row.id } })
          .catch((err: unknown) => err),
        'DELETE',
      );
      expectAppendOnlyRejection(
        await testApp.prisma.auditLog
          .deleteMany({ where: { id: row.id } })
          .catch((err: unknown) => err),
        'DELETE',
      );
      expect(
        await testApp.prisma.auditLog.count({ where: { id: row.id } }),
      ).toBe(1);
    });

    it('rejects TRUNCATE', async () => {
      const row = await recordOne(randomUUID());
      expectAppendOnlyRejection(
        await testApp.prisma.$executeRaw`TRUNCATE audit_logs`.catch(
          (err: unknown) => err,
        ),
        'TRUNCATE',
      );
      expect(
        await testApp.prisma.auditLog.count({ where: { id: row.id } }),
      ).toBe(1);
    });
  });
});
