import { NestFactory } from '@nestjs/core';
import {
  defaultDiseaseSource,
  DiseaseSeedError,
  describeSeedResult,
  planDiseaseSource,
  seedDiseaseSource,
} from '../diseases/disease-seed.js';
import { DiseaseSourceFormatError } from '../diseases/disease-source.parser.js';
import { dbErrorInfo, isDatabaseError } from '../prisma/db-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Loads the "Molim kasal" disease reference (reference data, not demo data)
 * from prisma/data/kasalliklar-manba.txt — idempotently:
 *
 *   node dist/cli/seed-diseases.js     # production image (after migrate)
 *   npm run db:seed:diseases           # development, from source
 *
 * Re-running is a no-op; a changed text under the same key is refused.
 */
async function main(): Promise<number> {
  // Read and checked before connecting: a broken file never opens a session.
  const source = defaultDiseaseSource();
  planDiseaseSource(source);

  // Imported here so an invalid environment (validated while the module is
  // being declared) is reported through the error handler below.
  const { CliModule } = await import('./cli.module.js');
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  try {
    const result = await seedDiseaseSource(app.get(PrismaService), source);
    process.stdout.write(`${describeSeedResult(result)}\n`);
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
    // Database errors may echo row contents: print only their codes.
    const message =
      err instanceof DiseaseSeedError || err instanceof DiseaseSourceFormatError
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
