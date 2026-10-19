import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));

// Resolved through Node so it works with the CLI hoisted to the monorepo
// root node_modules (same as `npx tsx prisma/seed.ts`).
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

export interface SeedResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `tsx prisma/seed.ts` with exactly the given environment (plus PATH,
 * HOME and the test DATABASE_URL): nothing leaks in from the shell or .env.
 */
export function runSeed(env: Record<string, string>): Promise<SeedResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TSX_CLI, 'prisma/seed.ts'],
      {
        cwd: BACKEND_DIR,
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          DATABASE_URL: process.env.DATABASE_URL ?? '',
          PASSWORD_SCRYPT_COST: '1024',
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** Changes whenever any demo user row is created or updated. */
export async function demoUsersFingerprint(
  prisma: PrismaClient,
): Promise<string> {
  const [row] = await prisma.$queryRaw<
    Array<{ count: bigint; updated: Date | null }>
  >`SELECT count(*) AS count, max(updated_at) AS updated FROM users WHERE is_demo`;
  return `${row.count}:${row.updated?.toISOString() ?? '-'}`;
}
