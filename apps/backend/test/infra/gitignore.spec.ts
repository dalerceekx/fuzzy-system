import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// REQUIREMENTS: `.env`, uploads, database dumps and private keys never get
// into Git. Asked of git itself (`check-ignore --no-index` evaluates the
// patterns whether or not a file exists or is tracked).

const REPO = join(fileURLToPath(new URL('../..', import.meta.url)), '../..');

function ignored(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], {
    cwd: REPO,
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${path}`);
  }
  return result.status === 0;
}

describe('root .gitignore', () => {
  it.each([
    '.env',
    'apps/backend/.env',
    'apps/backend/.env.local',
    'apps/backend/.env.production',
    'apps/frontend/.env',
    'apps/backend/uploads/files/ab/cd.jpg',
    'uploads/x.png',
    'backups/meningfermam-2026-10-16.dump',
    'apps/backend/db.dump',
    'apps/backend/dump.sql',
    'apps/backend/backup.sql.gz',
    'backup.dump.age',
    'apps/backend/secrets/server.key',
    'apps/backend/tls/cert.pem',
    'keystore.p12',
    'cert.pfx',
    'id_ed25519',
    'apps/backend/coverage/index.html',
    'apps/backend/dist/main.js',
    'apps/backend/tsconfig.build.tsbuildinfo',
    'apps/backend/src/generated/prisma/client.ts',
    'node_modules/x/index.js',
  ])('ignores %s', (path) => {
    expect(ignored(path)).toBe(true);
  });

  it.each([
    'apps/backend/.env.example',
    'apps/backend/prisma/migrations/20261016000100_security_foundation/migration.sql',
    'apps/backend/prisma/schema.prisma',
    'apps/backend/src/main.ts',
    'apps/backend/docker/postgres/init/01-roles.sh',
  ])('keeps %s tracked', (path) => {
    expect(ignored(path)).toBe(false);
  });
});
