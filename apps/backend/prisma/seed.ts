// Development/test-only seed:  npm run db:seed
// Loads the disease reference (reference data, also loadable on its own:
// npm run db:seed:diseases) and, when DEMO_ACCOUNTS_ENABLED=true, the demo
// accounts and data.
//
// It must never run against production, so the environment guard below runs
// before ANY module is loaded or any connection is opened. Keep this file
// free of static imports: ESM evaluates them before the first statement.

const ALLOWED_ENVIRONMENTS = new Set(['development', 'test']);

function refuseUnlessDevelopment(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!ALLOWED_ENVIRONMENTS.has(nodeEnv)) {
    console.error(
      `XATO: demo seed faqat development/test muhitida ishlaydi (NODE_ENV=${nodeEnv}). ` +
        'Production’da demo akkauntlar taqiqlangan.',
    );
    process.exit(1);
  }
}

refuseUnlessDevelopment();

// Like the API (ConfigModule ignoreEnvFile), tests never read .env.
if (process.env.NODE_ENV !== 'test') {
  const { config } = await import('dotenv');
  config({ quiet: true });
  // .env may itself say NODE_ENV=production.
  refuseUnlessDevelopment();
}

// Demo settings are validated before anything is written.
const demoEnabled = process.env.DEMO_ACCOUNTS_ENABLED === 'true';
const { resolveDemoConfig } = await import('./demo/config.js');
const resolved = demoEnabled ? resolveDemoConfig(process.env) : null;
if (!demoEnabled) {
  console.log('Demo seed o‘tkazib yuborildi: DEMO_ACCOUNTS_ENABLED=true emas.');
} else if (resolved && !resolved.ok) {
  console.error('XATO: demo seed sozlamalari noto‘g‘ri:');
  for (const error of resolved.errors) console.error(`  - ${error}`);
  console.error('Namuna qiymatlar: .env.example (Demo bo‘limi).');
  process.exit(1);
} else if (resolved?.ok) {
  for (const name of resolved.config.skipped) {
    console.log(`${name} berilmagan — bu demo akkaunt o‘tkazib yuborildi.`);
  }
}

const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('../src/generated/prisma/client.js');
const { isDatabaseError, dbErrorInfo } =
  await import('../src/prisma/db-errors.js');
const { DemoSeedError, seedDemo } = await import('./demo/seed-demo.js');
const { defaultDiseaseSource, describeSeedResult, seedDiseaseSource } =
  await import('../src/diseases/disease-seed.js');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  // Reference data, not demo data: the disease reference is loaded on every
  // dev/test seed (idempotent; production uses dist/cli/seed-diseases.js).
  const diseases = await seedDiseaseSource(prisma, defaultDiseaseSource());
  console.log(describeSeedResult(diseases));

  if (resolved?.ok) {
    await seedDemo(prisma, resolved.config, {
      scryptCost: Number(process.env.PASSWORD_SCRYPT_COST ?? 65_536),
      log: (message) => console.log(message),
    });
    console.log(
      'Demo seed yakunlandi. Parollar chiqarilmaydi — .env ga qarang.',
    );
  }
} catch (err) {
  // Database errors can carry whole rows (password hashes) in their
  // messages: print codes only. Disease seed refusals (checksum mismatch,
  // format) are safe to print.
  const message =
    err instanceof DemoSeedError ||
    (err instanceof Error &&
      (err.name === 'DiseaseSeedError' ||
        err.name === 'DiseaseSourceFormatError'))
      ? err.message
      : isDatabaseError(err)
        ? `ma’lumotlar bazasi xatosi ${JSON.stringify(dbErrorInfo(err) ?? {})}`
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : 'noma’lum xato';
  console.error(`XATO: seed bajarilmadi: ${message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
