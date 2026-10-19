import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Errors } from '../common/errors/app.exception.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { canonicalHash } from './canonical-json.js';
import { IDEMPOTENCY_KEY_PATTERN } from './idempotency-key.decorator.js';

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

export interface IdempotencyParams {
  userId: string;
  /** Static per operation, e.g. 'inventory.movement.create'. */
  scope: string;
  key: string;
  /** Everything that defines the request (route params + body). */
  request: unknown;
}

const SCOPE_PATTERN = /^[a-z][a-z0-9_.-]{0,119}$/;

@Injectable()
export class IdempotencyService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true });
  }

  /**
   * Runs `operation` at most once per (user, scope, key) inside one
   * ReadCommitted transaction that also stores the response:
   *
   * - first request: the key row is inserted, the operation runs, its
   *   response is stored, all in the same commit;
   * - a concurrent duplicate blocks on the unique index until the first
   *   commits, then replays the stored response (`replayed: true`);
   * - same key with a different payload → 409 IDEMPOTENCY_KEY_REUSED;
   * - if the operation throws, the key is rolled back too (errors are not
   *   cached, the client may retry with the same key).
   */
  async execute<T>(
    params: IdempotencyParams,
    operation: (tx: Tx) => Promise<IdempotentResult<T>>,
  ): Promise<IdempotentResult<T> & { replayed: boolean }> {
    const { userId, scope, key } = params;
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw Errors.badRequest(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key noto‘g‘ri',
      );
    }
    if (!SCOPE_PATTERN.test(scope)) {
      throw new Error(`Invalid idempotency scope: ${scope}`);
    }
    const requestHash = canonicalHash(params.request);

    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
        // An expired key may be used again for a new request.
        await tx.$executeRaw`
          DELETE FROM idempotency_keys
          WHERE user_id = ${userId}::uuid AND scope = ${scope} AND key = ${key}
            AND expires_at <= ${now}`;
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO idempotency_keys (id, user_id, scope, key, request_hash, created_at, expires_at)
          VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${scope}, ${key}, ${requestHash}, ${now}, ${expiresAt})
          ON CONFLICT (user_id, scope, key) DO NOTHING
          RETURNING id`;

        if (inserted.length === 0) {
          const existing = await tx.idempotencyKey.findUnique({
            where: { userId_scope_key: { userId, scope, key } },
            select: {
              requestHash: true,
              responseStatus: true,
              responseBody: true,
            },
          });
          if (!existing || existing.requestHash !== requestHash) {
            throw Errors.conflict(
              'IDEMPOTENCY_KEY_REUSED',
              'Bu Idempotency-Key boshqa so‘rov uchun ishlatilgan',
            );
          }
          if (existing.responseStatus === null) {
            throw Errors.conflict(
              'IDEMPOTENCY_KEY_IN_PROGRESS',
              'So‘rov hali bajarilmoqda',
            );
          }
          return {
            status: existing.responseStatus,
            body: (existing.responseBody ?? null) as T,
            replayed: true,
          };
        }

        const result = await operation(tx);
        // Stored and returned in the same JSON form, so a replay is
        // byte-identical to the first response.
        const body =
          result.body === undefined
            ? null
            : (JSON.parse(JSON.stringify(result.body)) as unknown);
        await tx.idempotencyKey.update({
          where: { id: inserted[0].id },
          data: {
            responseStatus: result.status,
            responseBody:
              body === null ? Prisma.DbNull : (body as Prisma.InputJsonValue),
          },
        });
        return { status: result.status, body: body as T, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
