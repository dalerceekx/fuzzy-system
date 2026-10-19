import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { randomToken } from './crypto.js';
import {
  hashPassword,
  needsRehash,
  padVerification,
  verifyPassword,
} from './password.js';

@Injectable()
export class PasswordService {
  private readonly cost: number;
  private readonly dummyHash: Promise<string>;

  constructor(config: ConfigService<Env, true>) {
    this.cost = config.get('PASSWORD_SCRYPT_COST', { infer: true });
    // Computed up front so even the first verifyDummy call costs exactly one
    // scrypt run, like a real verification.
    this.dummyHash = hashPassword(randomToken(), this.cost);
    this.dummyHash.catch(() => undefined);
  }

  hash(password: string): Promise<string> {
    return hashPassword(password, this.cost);
  }

  /**
   * A failed check against a weaker (legacy, lower-cost) or unparsable hash
   * is padded to the cost of a current-cost verification, so "wrong
   * password" always takes as long as "unknown phone" (verifyDummy) and
   * timing cannot reveal which numbers are registered.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const ok = await verifyPassword(password, stored);
    if (!ok) await padVerification(password, stored, this.cost);
    return ok;
  }

  needsRehash(stored: string): boolean {
    return needsRehash(stored, this.cost);
  }

  /**
   * Runs a full scrypt verification against a random hash with the current
   * parameters and always returns false, so "unknown phone" takes as long as
   * "wrong password" and response timing does not reveal registered numbers.
   */
  async verifyDummy(password: string): Promise<false> {
    await verifyPassword(password, await this.dummyHash);
    return false;
  }
}
