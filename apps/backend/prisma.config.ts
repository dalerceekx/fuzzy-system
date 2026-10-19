import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run as the schema owner (MIGRATION_DATABASE_URL); the API
    // itself connects as the least-privilege runtime role (DATABASE_URL).
    // `prisma generate` needs no database, so the URL stays optional here.
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  },
});
