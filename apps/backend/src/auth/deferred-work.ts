import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { dbErrorInfo } from '../prisma/db-errors.js';

/**
 * Runs account-dependent work after the response has been decided.
 *
 * register / password/forgot / otp/resend must not reveal whether a phone
 * (or verification id) belongs to an account — not by body and not by
 * timing. Their request path does only the work that is identical for every
 * input; the user lookup, OTP writes, audit and SMS run here. Tasks keep the
 * request's async context (request id in logs and audit rows). Failures
 * are logged by error class only and never reach the client.
 */
@Injectable()
export class DeferredWork implements OnModuleDestroy {
  private readonly logger = new Logger(DeferredWork.name);
  private readonly pending = new Set<Promise<void>>();

  run(task: string, work: () => Promise<unknown>): void {
    const promise: Promise<void> = Promise.resolve()
      .then(work)
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.error(
            {
              task,
              error: err instanceof Error ? err.name : 'UNKNOWN',
              db: dbErrorInfo(err) ?? undefined,
            },
            'deferred auth work failed',
          );
        },
      )
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  /** Resolves once every task started so far has finished. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }

  // Runs before Prisma/Redis close (onApplicationShutdown), so in-flight
  // OTP writes and SMS enqueues complete on a graceful shutdown.
  onModuleDestroy(): Promise<void> {
    return this.drain();
  }
}
