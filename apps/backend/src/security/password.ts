import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

// Pure functions (no Nest/config imports) so the seed and CLI scripts can use
// them. Format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`; the parameters are
// stored with the hash, so the cost can be raised later (see needsRehash).

const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Hashes written by the first version: `scrypt$<saltHex>$<hashHex>` with
// Node's default parameters.
const LEGACY = { N: 16_384, r: 8, p: 1 } as const;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs 128 * N * r * p bytes; Node's default cap is 32 MiB.
    maxmem: 256 * params.N * params.r * params.p,
  };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

function parse(stored: string): ScryptParams | null {
  if (typeof stored !== 'string' || stored.length > 512) return null;
  const parts = stored.split('$');
  const hex = /^(?:[0-9a-f]{2})+$/;

  if (parts.length === 3 && parts[0] === 'scrypt') {
    const [, saltHex, hashHex] = parts;
    if (!hex.test(saltHex) || !hex.test(hashHex)) return null;
    return {
      ...LEGACY,
      salt: Buffer.from(saltHex, 'hex'),
      hash: Buffer.from(hashHex, 'hex'),
    };
  }

  if (parts.length === 6 && parts[0] === 'scrypt') {
    const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
    const [N, r, p] = [nRaw, rRaw, pRaw].map((v) =>
      /^\d{1,8}$/.test(v) ? Number(v) : NaN,
    );
    const validParams =
      isPowerOfTwo(N) &&
      N >= 1024 &&
      N <= 2 ** 20 &&
      r >= 1 &&
      r <= 32 &&
      p >= 1 &&
      p <= 16;
    if (!validParams || !hex.test(saltHex) || !hex.test(hashHex)) return null;
    const hash = Buffer.from(hashHex, 'hex');
    if (hash.length < 16 || hash.length > 128) return null;
    return { N, r, p, salt: Buffer.from(saltHex, 'hex'), hash };
  }
  return null;
}

export async function hashPassword(
  password: string,
  cost: number,
): Promise<string> {
  if (!isPowerOfTwo(cost) || cost < 1024) {
    throw new RangeError('scrypt cost must be a power of two ≥ 1024');
  }
  const salt = randomBytes(SALT_BYTES);
  const params = { N: cost, r: BLOCK_SIZE, p: PARALLELIZATION };
  const hash = await deriveKey(password, salt, KEY_BYTES, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed || typeof password !== 'string') return false;
  const actual = await deriveKey(
    password,
    parsed.salt,
    parsed.hash.length,
    parsed,
  );
  return timingSafeEqual(actual, parsed.hash);
}

/** True when the stored hash is legacy, malformed or uses other parameters. */
export function needsRehash(stored: string, cost: number): boolean {
  const parsed = parse(stored);
  if (!parsed || stored.split('$').length !== 6) return true;
  return (
    parsed.N !== cost ||
    parsed.r !== BLOCK_SIZE ||
    parsed.p !== PARALLELIZATION ||
    parsed.hash.length !== KEY_BYTES
  );
}

const MIN_COST = 1024;

/**
 * scrypt N values to run after a FAILED verification so its total work
 * equals one verification at `cost` (the unknown-user / verifyDummy path).
 * Empty when the stored hash already used at least that cost. Hashes with a
 * lower cost (legacy `scrypt$salt$hash` = N 16384) or unparsable values
 * would otherwise answer faster and reveal that the account exists. scrypt
 * time is ~linear in N·r·p, so the gap is filled with powers of two.
 */
export function verificationPadding(stored: string, cost: number): number[] {
  const parsed = parse(stored);
  const done = parsed
    ? (parsed.N * parsed.r * parsed.p) / (BLOCK_SIZE * PARALLELIZATION)
    : 0;
  const runs: number[] = [];
  let remaining = cost - done;
  while (remaining >= MIN_COST) {
    let n = MIN_COST;
    while (n * 2 <= remaining) n *= 2;
    runs.push(n);
    remaining -= n;
  }
  return runs;
}

/** Burns the scrypt work listed by verificationPadding (result discarded). */
export async function padVerification(
  password: string,
  stored: string,
  cost: number,
): Promise<void> {
  for (const N of verificationPadding(stored, cost)) {
    await deriveKey(String(password), randomBytes(SALT_BYTES), KEY_BYTES, {
      N,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
    });
  }
}
