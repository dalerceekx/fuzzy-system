#!/usr/bin/env node
// Isolated production images, throwaway volumes, no AWS and no SMS sends.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './prepare.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'riizq-docker-smoke-'));
const config = join(scratch, 'config');
const project = `riizq-smoke-${process.pid}-${Date.now()}`;
const fakePassword = 'offline-only $ # " literal';
writeFileSync(
  join(scratch, 'eskiz.env'),
  `ESKIZ_EMAIL=smoke@example.test\nESKIZ_PASSWORD='${fakePassword}'\n`,
  { mode: 0o600 },
);
prepare({
  domain: 'smoke.riizq.test',
  region: 'us-east-1',
  bucket: 'private-smoke',
  out: config,
  eskizEnv: join(scratch, 'eskiz.env'),
  tag: 'aws-prep',
});
const env = {
  ...process.env,
  RIIZQ_CONFIG_DIR: config,
  HTTP_BIND: '127.0.0.1:0',
  HTTPS_BIND: '127.0.0.1:0',
  API_IMAGE: process.env.SMOKE_API_IMAGE ?? 'riizq-api:aws-prep',
  WEB_IMAGE: process.env.SMOKE_WEB_IMAGE ?? 'riizq-web:aws-prep',
};
const base = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  join(config, 'compose.env'),
  '-f',
  join(root, 'deploy/aws/compose.yaml'),
];
const override = join(scratch, 'smoke.yaml');
writeFileSync(
  override,
  `services:
  api:
    environment:
      S3_ENDPOINT: http://minio:9000
      S3_FORCE_PATH_STYLE: 'true'
      S3_ACCESS_KEY_ID: smoke-access-key
      S3_SECRET_ACCESS_KEY: smoke-secret-key-123456
      CORS_ORIGINS: https://localhost
    depends_on:
      minio-init: {condition: service_completed_successfully}
  web:
    environment: {SITE_DOMAIN: localhost}
  minio:
    image: pgsty/minio:RELEASE.2026-08-04T00-00-00Z
    command: [server, /data]
    environment:
      MINIO_ROOT_USER: smoke-access-key
      MINIO_ROOT_PASSWORD: smoke-secret-key-123456
    networks: [data]
  minio-init:
    image: pgsty/mc:RELEASE.2026-09-16T00-00-00Z
    entrypoint: [sh, -ec]
    command:
      - |
        for i in $$(seq 1 30); do
          if mc alias set local http://minio:9000 smoke-access-key smoke-secret-key-123456 >/dev/null 2>&1; then
            mc mb --ignore-existing local/private-smoke
            exit 0
          fi
          sleep 1
        done
        exit 1
    depends_on: [minio]
    networks: [data]
`,
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    // Never dump environment, docker inspect output, or generated files.
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr ?? ''}`,
    );
  }
  return result.stdout ?? '';
}
const compose = (...args) => run('docker', [...base, '-f', override, ...args]);
const curl = (...args) =>
  run('curl', ['--silent', '--show-error', '--max-time', '15', ...args]);
try {
  run('docker', [...base, 'config', '--quiet']);
  run('docker', [...base, 'run', '--rm', '--no-deps', 'api', 'check-env']);
  // Compose raw files must preserve Eskiz passwords containing $, # and quotes.
  run('docker', [
    ...base,
    'run',
    '--rm',
    '--no-deps',
    'api',
    'node',
    '-e',
    `if(process.env.ESKIZ_PASSWORD !== ${JSON.stringify(fakePassword)}) process.exit(1); if(process.env.MIGRATION_DATABASE_URL) process.exit(2)`,
  ]);
  console.log('PASS production preflight and secret transport');
  compose(
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
    'postgres',
    'redis',
    'minio',
  );
  compose('run', '--rm', 'migrate');
  // Repeated migrations and reference seed must be safe on the same volume.
  compose('run', '--rm', 'migrate');
  compose(
    'run',
    '--rm',
    '--no-deps',
    'api',
    'node',
    'dist/cli/seed-diseases.js',
  );
  compose(
    'run',
    '--rm',
    '--no-deps',
    'api',
    'node',
    'dist/cli/seed-diseases.js',
  );
  const rights = compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'meningfermam_app',
    '-d',
    'meningfermam',
    '-Atc',
    "SELECT current_user, has_schema_privilege('public','CREATE'), has_table_privilege('audit_logs','UPDATE'), has_table_privilege('farms','DELETE'), has_table_privilege('users','INSERT');",
  ).trim();
  assert.equal(rights, 'meningfermam_app|f|f|f|t');
  const demos = compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'meningfermam',
    '-Atc',
    'SELECT count(*) FROM users;',
  ).trim();
  assert.equal(demos, '0');
  console.log(
    'PASS migrations, reference seed, runtime DB permissions, no demo users',
  );
  // Exercise the actual read-only backup role and restore into a separate DB.
  // Binary dump remains in memory; the production backup script encrypts it.
  const dump = run(
    'docker',
    [
      ...base,
      '-f',
      override,
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$BACKUP_DB_PASSWORD" pg_dump -h 127.0.0.1 -U meningfermam_backup -d meningfermam --format=custom',
    ],
    { encoding: null },
  );
  compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-c',
    'CREATE DATABASE meningfermam_restore_smoke OWNER meningfermam_owner',
  );
  run(
    'docker',
    [
      ...base,
      '-f',
      override,
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      'meningfermam_restore_smoke',
      '--role=meningfermam_owner',
      '--no-owner',
      '--exit-on-error',
      '--single-transaction',
    ],
    { input: dump },
  );
  const restored = compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'meningfermam_restore_smoke',
    '-Atc',
    "SELECT (SELECT count(*) > 0 FROM diseases), has_table_privilege('meningfermam_app','audit_logs','UPDATE');",
  ).trim();
  assert.equal(restored, 't|f');
  console.log(
    'PASS backup role and database restore with preserved permissions',
  );
  compose('up', '-d', '--wait', '--wait-timeout', '180', 'api', 'web');
  const web = compose('ps', '-q', 'web').trim();
  run('docker', [
    'cp',
    `${web}:/data/caddy/pki/authorities/local/root.crt`,
    join(scratch, 'ca.crt'),
  ]);
  const port = compose('port', 'web', '443').trim().split(':').at(-1);
  const httpPort = compose('port', 'web', '80').trim().split(':').at(-1);
  const url = `https://localhost:${port}`;
  const request = (...args) =>
    curl('--cacert', join(scratch, 'ca.crt'), ...args);
  const health = JSON.parse(request(`${url}/api/v1/health`));
  assert.deepEqual(health, {
    status: 'ok',
    checks: { database: 'up', redis: 'up', storage: 'up' },
  });
  const html = request(`${url}/login`);
  assert.match(html, /<html/);
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)[1];
  const scripts = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const js = scripts.map((path) => request(`${url}${path}`)).join('\n');
  assert.ok(js.includes('/api/v1'));
  assert.ok(!js.includes('localhost:3001'));
  const headers = request('-I', `${url}/login`);
  assert.match(headers, /strict-transport-security:/i);
  assert.match(headers, /content-security-policy:/i);
  assert.match(
    request('-I', `${url}${asset}`),
    /cache-control: public, max-age=31536000, immutable/i,
  );
  assert.equal(
    request(
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      `${url}/assets/missing.js`,
    ),
    '404',
  );
  const apiMissing = request(`${url}/api/v1/route-that-does-not-exist`);
  assert.doesNotMatch(apiMissing, /<html/);
  assert.equal(
    request(
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      `${url}/api/v1/dev/sms-inbox`,
    ),
    '404',
  );
  const redirect = curl('-I', `http://localhost:${httpPort}/login`);
  assert.match(redirect, /308/);
  assert.match(redirect, /location: https:\/\/localhost\/login/i);
  for (const service of ['api', 'postgres', 'redis']) {
    const id = compose('ps', '-q', service).trim();
    const bindings = JSON.parse(
      run('docker', [
        'inspect',
        '--format',
        '{{json .HostConfig.PortBindings}}',
        id,
      ]),
    );
    assert.ok(!bindings || Object.keys(bindings).length === 0);
  }
  console.log(
    'PASS trusted TLS, HTTP redirect, SPA routes, same-origin API, all dependency health, private ports',
  );
} finally {
  try {
    compose('down', '--volumes', '--remove-orphans', '--timeout', '10');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
