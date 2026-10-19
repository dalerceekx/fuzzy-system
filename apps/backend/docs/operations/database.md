# Ma’lumotlar bazasi: rollar, huquqlar, ulanish

PostgreSQL 16. Sxema `prisma/schema.prisma` da, Prisma ifoda eta olmaydigan
qoidalar (CHECK, partial unique index, trigger, grant) esa
`prisma/migrations/20261016000100_security_foundation/migration.sql` da
(yem ratsionlari uchun — `20261019000000_feed_rations/migration.sql`).

## Rollar

| Rol | Kim ishlatadi | Huquqlari |
| --- | --- | --- |
| `meningfermam_owner` (dev’da `postgres`) | faqat release bosqichi: `prisma migrate deploy` (`MIGRATION_DATABASE_URL`) | sxema egasi: DDL |
| `meningfermam_app` | API runtime (`DATABASE_URL`) | faqat DML, quyida |
| `meningfermam_backup` | `scripts/db/backup.sh` | faqat o‘qish (`pg_read_all_data`) |

API hech qachon sxema egasi bo‘lib ulanmaydi: SQL injection yoki RCE bo‘lsa ham
jadval o‘chirish, trigger’ni o‘chirish yoki audit log’ni tahrirlash imkoni yo‘q.

`meningfermam_app` ning huquqlari migratsiyaning o‘zida beriladi (rol mavjud
bo‘lsa):

- `SELECT, INSERT, UPDATE` — biznes jadvallar (`users`, `sessions`, `farms`,
  `animals`, `inventory_items`, `medicines`, `protocols`, …);
- `SELECT, INSERT` — append-only jadvallar: `audit_logs`, `stock_movements`,
  `treatment_doses`, `ration_issues` (UPDATE/DELETE/TRUNCATE ni trigger ham
  rad etadi);
- `DELETE` — faqat vaqtinchalik qatorlar: `sessions`, `otp_codes`,
  `idempotency_keys`, `protocol_drugs` (draft versiya dorilari),
  `ration_items` (ratsion tahrirlanganda yem ro‘yxati almashtiriladi);
- DDL, `TRUNCATE`, boshqa jadvallarda `DELETE` — yo‘q (muhim yozuvlar
  archive/soft delete qilinadi).

## Production’da rollarni yaratish

Rollar **birinchi migratsiyadan oldin** yaratilishi kerak — aks holda migratsiya
grant’larni o‘tkazib yuboradi (keyin `GRANT` larni qo‘lda takrorlang).
RDS’da master foydalanuvchi bilan bir marta bajariladi; parollar secret
manager’da yaratiladi (`openssl rand -base64 32`) va bu yerga yozilmaydi:

```sql
-- 1. Rollar (parollarni psql \password bilan kiriting, tarixga tushmasin)
CREATE ROLE meningfermam_owner LOGIN;
CREATE ROLE meningfermam_app LOGIN;
CREATE ROLE meningfermam_backup LOGIN;
\password meningfermam_owner
\password meningfermam_app
\password meningfermam_backup

-- 2. Baza egasi — migrator rol
CREATE DATABASE meningfermam OWNER meningfermam_owner;
\c meningfermam

-- 3. Hech kim (PUBLIC) public sxemada obyekt yarata olmasin
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE meningfermam FROM PUBLIC;
ALTER SCHEMA public OWNER TO meningfermam_owner;

-- 4. Runtime va backup rollariga faqat ulanish + o‘qish/DML
GRANT CONNECT ON DATABASE meningfermam TO meningfermam_app, meningfermam_backup;
GRANT USAGE ON SCHEMA public TO meningfermam_app, meningfermam_backup;
GRANT pg_read_all_data TO meningfermam_backup;   -- PostgreSQL 14+

-- 5. Kelajakdagi jadvallar (owner yaratadi) uchun default huquqlar.
--    Migratsiya ham shuni o‘rnatadi; append-only jadvallar o‘z
--    migratsiyasida qattiqlashtiriladi.
ALTER DEFAULT PRIVILEGES FOR ROLE meningfermam_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO meningfermam_app;

-- 6. Vaqt zonasi: PrismaService ulanish TimeZone=UTC bo‘lmasa ishga tushmaydi
ALTER DATABASE meningfermam SET timezone TO 'UTC';
ALTER ROLE meningfermam_app SET timezone TO 'UTC';

-- 7. Runtime rol uchun cheklovlar
ALTER ROLE meningfermam_app SET statement_timeout = '15s';
ALTER ROLE meningfermam_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE meningfermam_app CONNECTION LIMIT 50;
```

Shundan so‘ng release bosqichi (`compose.prod.yaml` → `migrate`) migratsiyalarni
`meningfermam_owner` bilan bajaradi va `meningfermam_app` ga grant’larni beradi.

Tekshirish (`meningfermam_app` bilan ulanib):

```sql
SELECT has_table_privilege('audit_logs', 'UPDATE');    -- f
SELECT has_table_privilege('farms', 'DELETE');         -- f
SELECT has_schema_privilege('public', 'CREATE');       -- f
```

## Ulanish: TLS majburiy

- `DATABASE_URL` / `MIGRATION_DATABASE_URL` da `sslmode=verify-full` va RDS CA
  sertifikati: `…?sslmode=verify-full&sslrootcert=/etc/ssl/rds-ca.pem`.
- RDS parameter group: `rds.force_ssl = 1`.
- Baza faqat private subnet’da; security group faqat API va release
  task’laridan 5432 portga ruxsat beradi (`deployment.md`).

## Muhim DB qoidalari (oxirgi himoya chizig‘i)

Ilova bularni o‘zi ham tekshiradi va toza 4xx qaytaradi; DB — zaxira himoya:

- telefon `+998…` E.164 formatda va unique; email `citext` (katta-kichik
  harfsiz unique) va kichik harfda;
- `inventory_items.quantity >= 0`, `stock_movements.balance_after >= 0`;
- `audit_logs`, `stock_movements`, `treatment_doses`, `ration_issues` —
  append-only trigger;
- `disease_sources`, `disease_groups`, `diseases` — o‘zgarmas ma’lumotnoma
  (UPDATE/DELETE/TRUNCATE trigger bilan rad etiladi; runtime rolga faqat
  `SELECT, INSERT`); tuzatilgan matn — yangi manba kaliti;
- tasdiqlangan dori/protokol versiyasi o‘zgarmaydi; faqat joriy roli `VET`
  bo‘lgan foydalanuvchi tasdiqlay oladi; demo dori/protokol hech qachon
  tasdiqlanmaydi;
- oxirgi faol `SUPER_ADMIN` ni pasaytirish/bloklash/arxivlash taqiqlangan
  (deferred constraint trigger);
- fermalararo bog‘lanishlar (hayvon ↔ fayl, ombor ↔ harakat ↔ davolash,
  ratsion ↔ kategoriya ↔ yem ↔ chiqim) trigger bilan tekshiriladi.

## Development

`compose.dev.yaml` dagi PostgreSQL birinchi marta (yangi volume) ishga
tushganda `docker/postgres/init/01-roles.sh`:

- `meningfermam_app` rolini yaratadi (dev paroli `meningfermam_app_dev`);
- `REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
- e2e testlar uchun `meningfermam_test` bazasini yaratadi;
- vaqt zonasini `UTC` qiladi.

Dev’da API loyiha egasi tanlagan `postgres:1234` bilan ulanadi (faqat dev).
Least-privilege rejimini lokal sinash uchun `.env` da:

```env
DATABASE_URL=postgresql://meningfermam_app:meningfermam_app_dev@postgres:5432/meningfermam?schema=public
```

va `compose.dev.yaml` dagi `DATABASE_URL` ni ham shunga almashtiring
(`MIGRATION_DATABASE_URL` `postgres` bilan qoladi). Eski volume’da init skript
ishlamaydi: `npm run dev:reset` (barcha dev ma’lumotlari o‘chadi).
