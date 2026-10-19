-- New roles live in a migration of their own: PostgreSQL cannot use an enum
-- value in the same transaction that adds it, and the next migration does.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPORT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VET';
