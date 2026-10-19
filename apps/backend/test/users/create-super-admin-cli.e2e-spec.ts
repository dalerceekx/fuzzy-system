import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { maskPhone } from '../../src/common/phone.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { verifyPassword } from '../../src/security/password.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { archiveOtherActiveSuperAdmins } from './support.js';

const BACKEND_ROOT = join(import.meta.dirname, '..', '..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const PASSWORD = 'Bootstrap-secret-2026';

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the CLI from source with the test environment; password on stdin. */
function runCli(
  env: Record<string, string | undefined>,
  stdin: string,
): Promise<CliResult> {
  const childEnv = { ...process.env, ...env };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, 'src/cli/create-super-admin.ts'],
      {
        cwd: BACKEND_ROOT,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe('create-super-admin CLI', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: [] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const userByPhone = (phone: string) =>
    testApp.prisma.user.findUnique({ where: { phone } });

  it('refuses while a real ACTIVE SUPER_ADMIN exists', async () => {
    await createUser(testApp.prisma, { role: UserRole.SUPER_ADMIN });
    const phone = await uniquePhone();

    const result = await runCli(
      { BOOTSTRAP_PHONE: phone, BOOTSTRAP_FULL_NAME: 'Bosh Admin' },
      `${PASSWORD}\n`,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Faol SUPER_ADMIN allaqachon mavjud');
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
    expect(await userByPhone(phone)).toBeNull();
  }, 60_000);

  it('creates the first SUPER_ADMIN from a stdin password, never echoing it', async () => {
    // A demo SUPER_ADMIN keeps the DB invariant ("one ACTIVE SUPER_ADMIN
    // remains") satisfied while every real one from earlier tests is retired;
    // demo accounts do not count as an existing administrator.
    const { user: demoSuperAdmin } = await createUser(testApp.prisma, {
      role: UserRole.SUPER_ADMIN,
      isDemo: true,
    });
    await archiveOtherActiveSuperAdmins(testApp.prisma, [demoSuperAdmin.id]);
    const phone = await uniquePhone();

    const result = await runCli(
      {
        BOOTSTRAP_PHONE: phone.slice(4), // local notation is normalized
        BOOTSTRAP_FULL_NAME: '  Bosh   Administrator ',
      },
      `${PASSWORD}\n`,
    );

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(maskPhone(phone));
    expect(result.stdout).not.toContain(phone);
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);

    const user = await userByPhone(phone);
    expect(user).toMatchObject({
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      fullName: 'Bosh   Administrator',
      isDemo: false,
      mfaEnabled: false,
      mfaSecretEnc: null,
    });
    expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
    await expect(verifyPassword(PASSWORD, user!.passwordHash)).resolves.toBe(
      true,
    );

    const audit = await testApp.prisma.auditLog.findMany({
      where: { resourceId: user!.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'system.super_admin.bootstrapped',
      resourceType: 'user',
      actorId: null,
      actorRole: null,
      newValue: { role: UserRole.SUPER_ADMIN, phoneMasked: maskPhone(phone) },
    });
    expect(JSON.stringify(audit[0])).not.toContain('scrypt$');

    // The freshly created administrator now blocks a second bootstrap.
    const secondPhone = await uniquePhone();
    const second = await runCli(
      { BOOTSTRAP_PHONE: secondPhone, BOOTSTRAP_FULL_NAME: 'Ikkinchi' },
      `${PASSWORD}\n`,
    );
    expect(second.code).toBe(1);
    expect(await userByPhone(secondPhone)).toBeNull();
  }, 90_000);

  it.each([
    ['a weak password', { BOOTSTRAP_FULL_NAME: 'Bosh Admin' }, 'password\n'],
    ['an empty stdin', { BOOTSTRAP_FULL_NAME: 'Bosh Admin' }, ''],
    [
      'a missing full name',
      { BOOTSTRAP_FULL_NAME: undefined },
      `${PASSWORD}\n`,
    ],
  ])(
    'rejects %s without touching the database',
    async (_name, env, stdin) => {
      const phone = await uniquePhone();
      const result = await runCli({ BOOTSTRAP_PHONE: phone, ...env }, stdin);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/^Xato: /);
      expect(result.stdout + result.stderr).not.toContain(PASSWORD);
      expect(await userByPhone(phone)).toBeNull();
    },
    60_000,
  );

  it('rejects an invalid or demo-range BOOTSTRAP_PHONE', async () => {
    for (const phone of ['12345', '+998000000777']) {
      const result = await runCli(
        { BOOTSTRAP_PHONE: phone, BOOTSTRAP_FULL_NAME: 'Bosh Admin' },
        `${PASSWORD}\n`,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('BOOTSTRAP_PHONE');
    }
  }, 60_000);
});
