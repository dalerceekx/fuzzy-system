import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRole } from '../../generated/prisma/enums.js';

export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  role?: UserRole;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    // A copy, so a caller's object is never mutated by `set`.
    return storage.run({ ...data }, fn);
  },

  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  /** Mutates the current request's context (no-op outside a request). */
  set(patch: Partial<RequestContextData>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, patch);
  },
};
