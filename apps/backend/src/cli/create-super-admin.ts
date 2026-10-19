import { NestFactory } from '@nestjs/core';
import { AuditService } from '../audit/audit.service.js';
import { dbErrorInfo, isDatabaseError } from '../prisma/db-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import {
  assertBootstrapPassword,
  BootstrapError,
  bootstrapSuperAdmin,
  validateBootstrapTarget,
} from './bootstrap-super-admin.js';
import { readPassword } from './read-password.js';

/**
 * Bootstraps the first SUPER_ADMIN of an installation:
 *
 *   BOOTSTRAP_PHONE=+998901234567 BOOTSTRAP_FULL_NAME='Ism Familiya' \
 *     node dist/cli/create-super-admin.js        # password from stdin
 *
 * The password is read from stdin only and is never printed.
 */
async function main(): Promise<number> {
  const target = validateBootstrapTarget(
    process.env.BOOTSTRAP_PHONE,
    process.env.BOOTSTRAP_FULL_NAME,
  );
  const password = await readPassword('Parol: ');
  if (process.stdin.isTTY) {
    const confirmation = await readPassword('Parolni takrorlang: ');
    if (confirmation !== password) {
      throw new BootstrapError('Parollar mos kelmadi');
    }
  }
  assertBootstrapPassword(password, target.phone);

  // Imported here so an invalid environment (validated while the module is
  // being declared) is reported through the error handler below.
  const { CliModule } = await import('./cli.module.js');
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  try {
    const created = await bootstrapSuperAdmin(
      {
        prisma: app.get(PrismaService),
        passwords: app.get(PasswordService),
        audit: app.get(AuditService),
      },
      { ...target, password },
    );
    process.stdout.write(
      `SUPER_ADMIN yaratildi: ${created.phoneMasked} (id: ${created.id}). ` +
        'Birinchi kirishda ikki bosqichli tasdiqlash (TOTP) sozlanadi.\n',
    );
    return 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // Database errors can carry whole rows (incl. password hashes) in their
    // messages: print only their codes.
    const message =
      err instanceof BootstrapError
        ? err.message
        : isDatabaseError(err)
          ? `Ma’lumotlar bazasi xatosi ${JSON.stringify(dbErrorInfo(err) ?? {})}`
          : err instanceof Error
            ? err.message
            : 'Noma’lum xato';
    process.stderr.write(`Xato: ${message}\n`);
    process.exitCode = 1;
  },
);
