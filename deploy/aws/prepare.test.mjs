import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, rawEnv } from './prepare.mjs';

const read = (path) =>
  Object.fromEntries(
    readFileSync(path, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => {
        const equal = line.indexOf('=');
        return [line.slice(0, equal), line.slice(equal + 1)];
      }),
  );

test('new production secrets, least-privilege URLs and file permissions; no dev settings imported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'riizq-prepare-test-'));
  try {
    const source = join(dir, 'source.env');
    writeFileSync(
      source,
      "ESKIZ_EMAIL=account@example.test\nESKIZ_PASSWORD='secret $ # \" literal'\nDEMO_PASSWORD=must-not-copy\nOTP_PEPPER=must-not-copy\nS3_ACCESS_KEY_ID=must-not-copy\n",
    );
    const out = join(dir, 'config');
    const opts = {
      domain: 'riizq.uz',
      region: 'eu-central-1',
      bucket: 'private-test-bucket',
      out,
      eskizEnv: source,
      tag: 'test',
    };
    assert.deepEqual(prepare(opts).missing, []);
    const api = read(join(out, 'api.env'));
    const pg = read(join(out, 'postgres.env'));
    const migrate = read(join(out, 'migrate.env'));
    assert.equal(api.ESKIZ_PASSWORD, 'secret $ # " literal');
    assert.equal(api.DEMO_PASSWORD, undefined);
    assert.equal(api.OTP_PEPPER, undefined);
    assert.equal(api.MIGRATION_DATABASE_URL, undefined);
    assert.equal(api.S3_ACCESS_KEY_ID, '');
    assert.equal(new URL(api.DATABASE_URL).username, 'meningfermam_app');
    assert.equal(new URL(api.DATABASE_URL).password, pg.APP_DB_PASSWORD);
    assert.equal(
      new URL(migrate.MIGRATION_DATABASE_URL).password,
      pg.OWNER_DB_PASSWORD,
    );
    assert.notEqual(pg.OWNER_DB_PASSWORD, pg.APP_DB_PASSWORD);
    assert.equal(
      new URL(api.REDIS_URL).password,
      read(join(out, 'redis.env')).REDIS_PASSWORD,
    );
    assert.equal(Buffer.from(api.DATA_ENCRYPTION_KEY, 'base64').length, 32);
    const secrets = [
      api.JWT_ACCESS_SECRET,
      api.JWT_REFRESH_SECRET,
      api.OTP_HMAC_SECRET,
    ];
    assert.equal(new Set(secrets).size, 3);
    assert.ok(secrets.every((value) => /^[a-f0-9]{96}$/.test(value)));
    assert.equal(statSync(out).mode & 0o777, 0o700);
    assert.equal(statSync(join(out, 'api.env')).mode & 0o777, 0o600);
    const before = readFileSync(join(out, 'api.env'), 'utf8');
    assert.throws(() => prepare(opts), { code: 'EEXIST' });
    assert.equal(readFileSync(join(out, 'api.env'), 'utf8'), before);
    prepare({ ...opts, out: join(dir, 'second') });
    assert.notEqual(
      read(join(dir, 'second/api.env')).DATA_ENCRYPTION_KEY,
      api.DATA_ENCRYPTION_KEY,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raw environment prevents multiline injection without changing secret characters', () => {
  assert.equal(rawEnv({ TOKEN: 'a$#"\'b=' }), 'TOKEN=a$#"\'b=\n');
  for (const value of ['a\nNODE_ENV=test', 'a\rb', 'a\0b']) {
    assert.throws(() => rawEnv({ TOKEN: value }));
  }
  assert.throws(() => rawEnv({ 'A\nB': 'value' }));
});

test('refuses unsafe domains and image tags before creating files', () => {
  for (const domain of [
    'https://riizq.uz',
    'riizq.uz/path',
    'riizq.uz\n:80',
    '{$SECRET}',
    '',
  ]) {
    assert.throws(() => prepare({ domain }));
  }
  assert.throws(() => prepare({ domain: 'riizq.uz', tag: 'bad\nTAG=x' }));
});
