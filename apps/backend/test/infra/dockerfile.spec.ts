import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopy, parseDockerfile, type Stage } from './dockerfile.js';

// Static checks of the production image definition (the Docker daemon is
// not needed; CI additionally builds the image and inspects it).

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const REPO = join(BACKEND, '../..');
const read = (path: string) => readFileSync(path, 'utf8');

const dockerfile = parseDockerfile(read(join(BACKEND, 'Dockerfile')));
const runner = dockerfile.stages.at(-1) as Stage;
const all = dockerfile.stages.flatMap((stage) => stage.instructions);
const of = (stage: Stage, keyword: string) =>
  stage.instructions.filter((i) => i.keyword === keyword);

describe('production Dockerfile', () => {
  it('is multi-stage: deps → build → prod-deps → runner', () => {
    expect(dockerfile.stages.map((s) => s.name)).toEqual([
      'deps',
      'build',
      'prod-deps',
      'runner',
    ]);
  });

  it('uses one pinned node:22 alpine base everywhere', () => {
    const arg = dockerfile.args.find((a) => a.args.startsWith('NODE_IMAGE='));
    expect(arg?.args).toMatch(/^NODE_IMAGE=node:22\.\d+\.\d+-alpine\d+\.\d+$/);
    const names = new Set(dockerfile.stages.map((s) => s.name));
    for (const stage of dockerfile.stages) {
      expect(stage.base === '${NODE_IMAGE}' || names.has(stage.base)).toBe(
        true,
      );
    }
  });

  it('installs with npm ci only, production deps without devDependencies', () => {
    const runs = all.filter((i) => i.keyword === 'RUN').map((i) => i.args);
    expect(runs.join('\n')).not.toMatch(
      /\b(npm|yarn|pnpm)\s+(install|i|add|update)\b/,
    );
    expect(runs.some((r) => /\bnpm ci\b/.test(r))).toBe(true);
    const prodDeps = dockerfile.stages.find((s) => s.name === 'prod-deps')!;
    expect(
      of(prodDeps, 'RUN')
        .map((i) => i.args)
        .join('\n'),
    ).toMatch(/npm ci --workspace apps\/backend --omit=dev/);
    expect(all.some((i) => i.keyword === 'ADD')).toBe(false);
  });

  it('runs the final stage as a fixed non-root numeric user', () => {
    const users = of(runner, 'USER');
    expect(users.length).toBeGreaterThan(0);
    const user = users.at(-1)!.args;
    expect(user).toMatch(/^\d+:\d+$/);
    const [uid, gid] = user.split(':').map(Number);
    expect(uid).toBeGreaterThanOrEqual(10000);
    expect(gid).toBeGreaterThanOrEqual(10000);
    // USER comes before the process starts (no later root switch).
    const index = runner.instructions.lastIndexOf(users.at(-1)!);
    const later = runner.instructions.slice(index + 1).map((i) => i.keyword);
    expect(later).not.toContain('RUN');
  });

  it('copies no seed, sources, tests or env files into the runner', () => {
    const copies = of(runner, 'COPY').map((i) => parseCopy(i.args));
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      if (copy.from) expect(['build', 'prod-deps']).toContain(copy.from);
      for (const source of copy.sources) {
        expect(source).not.toMatch(
          /seed|prisma\/demo|\/src\b|^src\b|\btest\b|\.env|\.git/,
        );
        // Only explicitly listed files, never the whole context.
        expect(source).not.toMatch(/^\.\/?$|^apps\/backend\/?$|\*/);
      }
    }
    const sources = copies.flatMap((c) => c.sources);
    expect(sources).toContain('/repo/apps/backend/dist');
    expect(sources).toContain('apps/backend/prisma/migrations');
    expect(sources).toContain('apps/backend/docker/prod-entrypoint.sh');
    // Reference data for dist/cli/seed-diseases.js (../../prisma/data/…).
    const diseaseSource = copies.find((c) =>
      c.sources.includes('apps/backend/prisma/data/kasalliklar-manba.txt'),
    );
    expect(diseaseSource?.dest).toBe('./prisma/data/kasalliklar-manba.txt');
  });

  it('the disease reference source is not excluded from the build context', () => {
    const ignore = read(join(REPO, '.dockerignore'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const excluding = ignore.filter((pattern) =>
      /\.txt$|^apps\/backend\/prisma\/?(data|\*\*)?\/?$|prisma\/data/.test(
        pattern,
      ),
    );
    expect(excluding).toEqual([]);
  });

  it('removes package managers, has HEALTHCHECK, STOPSIGNAL and no baked secrets', () => {
    const runs = of(runner, 'RUN')
      .map((i) => i.args)
      .join('\n');
    for (const tool of ['npm', 'npx', 'corepack', 'yarn']) {
      expect(runs).toContain(`/usr/local/bin/${tool}`);
    }
    const healthcheck = of(runner, 'HEALTHCHECK');
    expect(healthcheck).toHaveLength(1);
    expect(healthcheck[0].args).toContain('/api/v1/health/live');
    expect(of(runner, 'STOPSIGNAL')[0]?.args).toBe('SIGTERM');
    expect(
      of(runner, 'ENV')
        .map((i) => i.args)
        .join(' '),
    ).toMatch(/NODE_ENV=production/);

    const declared = [...dockerfile.args, ...all]
      .filter((i) => i.keyword === 'ENV' || i.keyword === 'ARG')
      .map((i) => i.args)
      .join(' ');
    expect(declared).not.toMatch(
      /SECRET|PASSWORD|TOKEN|PEPPER|API_KEY|ENCRYPTION_KEY/,
    );
  });

  it('never seeds from the production entrypoint; migrate uses MIGRATION_DATABASE_URL', () => {
    const entrypoint = read(join(BACKEND, 'docker/prod-entrypoint.sh'));
    const code = entrypoint.replace(/^\s*#.*$/gm, '');
    expect(code).not.toMatch(/seed|tsx|DEMO_/);
    expect(entrypoint).toContain('MIGRATION_DATABASE_URL');
    expect(entrypoint).toMatch(/set -eu/);
  });

  it('dev entrypoint runs the demo seed only when DEMO_ACCOUNTS_ENABLED=true', () => {
    const entrypoint = read(join(BACKEND, 'docker/dev-entrypoint.sh'));
    expect(entrypoint).toMatch(
      /if \[ "\$\{DEMO_ACCOUNTS_ENABLED:-false\}" = "true" \]; then[\s\S]*db:seed[\s\S]*fi/,
    );
    expect(entrypoint.match(/db:seed/g)).toHaveLength(1);
  });
});

describe('.dockerignore (repo root = build context)', () => {
  const lines = read(join(REPO, '.dockerignore'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('keeps secrets, uploads, dumps, keys, tests and the seed out of the context', () => {
    for (const pattern of [
      '**/.env*',
      '.deploy',
      '**/uploads',
      '**/backups',
      '**/*.dump',
      '**/*.sql.gz',
      '**/*.pem',
      '**/*.key',
      '**/*.p12',
      '**/*.pfx',
      '**/coverage',
      '**/node_modules',
      'apps/backend/test',
      'apps/backend/prisma/seed.ts',
      'apps/backend/prisma/demo',
      'apps/backend/docs',
      '.github',
      '.git',
    ]) {
      expect(lines).toContain(pattern);
    }
    // .env.example must not be re-included either.
    expect(lines.some((l) => l.startsWith('!') && l.includes('.env'))).toBe(
      false,
    );
  });
});

describe('compose files', () => {
  it('production: hardened container, API on loopback only, no database service', () => {
    const prod = read(join(BACKEND, 'compose.prod.yaml'));
    expect(prod).toMatch(/user: "10001:10001"/);
    expect(prod).toMatch(/read_only: true/);
    expect(prod).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(prod).toMatch(/no-new-privileges:true/);
    expect(prod).toMatch(/init: true/);
    expect(prod).toMatch(/pids_limit: \d+/);
    expect(prod).toMatch(/stop_grace_period: 30s/);
    expect(prod).toMatch(/\/tmp:[^\n]*noexec[^\n]*nosuid/);
    expect(prod).not.toMatch(/image:\s*(postgres|redis)/);
    const ports = prod.match(/^\s+- "[^"]*:3001"$/gm) ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/"127\.0\.0\.1:/);
  });

  it('development: every published port is bound to 127.0.0.1', () => {
    const dev = read(join(BACKEND, 'compose.dev.yaml'));
    const ports = [...dev.matchAll(/^\s+ports:\n((?:\s+- .*\n)+)/gm)].flatMap(
      (m) => m[1].trim().split('\n'),
    );
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/- "127\.0\.0\.1:/);
    expect(dev).toContain(
      './docker/postgres/init:/docker-entrypoint-initdb.d:ro',
    );
    expect(dev).toContain('MIGRATION_DATABASE_URL');
  });
});
