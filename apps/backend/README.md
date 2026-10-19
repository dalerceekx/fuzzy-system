# Mening Fermam — backend

Fermerlar uchun "Mening Fermam" ilovasining API’si. Monorepo’dagi joyi:
`apps/backend` (frontend — `apps/frontend`, umumiy ma’lumot —
[`../../README.md`](../../README.md)).

**Stack:** Node.js 22 · NestJS 12 (Express 5, ESM) · Prisma 7 + PostgreSQL 16 ·
Redis 7 · S3 (dev’da MinIO) · Zod · pino · Vitest · oxlint · Docker.

## Mundarija

1. [Nimalar qilingan](#nimalar-qilingan)
2. [Rollar](#rollar)
3. [Auth oqimlari](#auth-oqimlari)
4. [API](#api)
5. [Tez start (development)](#tez-start-development)
6. [Demo akkauntlar](#demo-akkauntlar)
7. [Testlar](#testlar)
8. [Environment o‘zgaruvchilari](#environment-ozgaruvchilari)
9. [Komandalar](#komandalar)
10. [Production](#production)
11. [Hujjatlar](#hujjatlar)

---

## Nimalar qilingan

Production xavfsizlik talablari asosida qayta qurilgan. Har talab qanday
bajarilgani va kod joylashuvi: [`docs/security/overview.md`](docs/security/overview.md).

> Platforma qatlami, DB constraint’lari va infra tayyor; funksional modullar
> (auth, users, sms, files, farms/animals, inventory, vet) parallel
> yozilmoqda va integratsiya bosqichida e2e testlar bilan tasdiqlanadi.
> Ularning tavsifi quyida loyiha kontraktiga asoslangan.

- **Konfiguratsiya** — `src/config/env.ts`: barcha env Zod bilan tekshiriladi,
  production’da xavfli sozlamalar (mock SMS, demo akkaunt/parol, Secure
  bo‘lmagan cookie, `LOG_PRETTY`, kuchsiz scrypt, local storage, `TRUST_PROXY=true`,
  CORS `*`) bo‘lsa ilova ishga tushmaydi.
- **HTTP qattiqlashtirish** — `src/app.setup.ts`: trusted proxy validatsiyasi,
  HTTPS majburiyligi, Helmet (qat’iy CSP, HSTS faqat production HTTPS),
  `Cache-Control: no-store`, aniq CORS allowlist, body limit, global
  `ValidationPipe` (whitelist + forbidNonWhitelisted), xatolarda stack/SQL/
  secret yo‘q, har so‘rovga `X-Request-Id`, graceful shutdown.
- **Autentifikatsiya** — telefon + parol (scrypt), telefonni OTP bilan
  tasdiqlash, SUPER_ADMIN/ADMIN uchun majburiy TOTP MFA, qisqa access JWT +
  rotatsiya qilinadigan refresh token (reuse detection), web uchun HttpOnly
  cookie + CSRF, per-IP va per-akkaunt rate limit, lockout.
- **Avtorizatsiya** — fail-closed: har route’da aniq bitta `@Public()` yoki
  `@Roles(...)`; har so‘rovda sessiya va joriy rol DB’dan o‘qiladi (JWT’da rol
  yo‘q); begona resurs → 404.
- **Audit** — append-only `audit_logs` (trigger + grant), sanitizer secret’larni
  yozmaydi.
- **Idempotency** — `Idempotency-Key` (foydalanuvchi + amal scope’i), boshqa
  payload → 409.
- **Fayllar** — MIME + magic bytes + extension, UUID kalit, kvota, private S3,
  signed URL / ownership tekshiruvchi endpoint, metadata tozalash.
- **Domen** — fermalar, hayvonlar (archive), ombor (Decimal, ledger,
  manfiy qoldiq DB darajasida taqiqlangan), veterinariya (dori/protokol faqat
  VET tasdiqlaydi, tasdiqlangan versiya o‘zgarmaydi, davolash snapshot’i,
  withdrawal muddatlari, emergency’da avtomatik dori yo‘q).
- **Logging** — pino structured JSON, Authorization/Cookie/parol/OTP/token
  redaction, telefonlar maskalangan.
- **Infra** — multi-stage non-root Docker image, qattiqlashtirilgan
  `compose.prod.yaml`, least-privilege DB rollari, shifrlangan backup + oylik
  restore testi, CI (typecheck, lint, test, audit, gitleaks, semgrep, Trivy).

## Rollar

| Rol | Kim | Asosiy huquqlar | MFA |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | tizim egasi | hamma admin amallari, ADMIN/SUPER_ADMIN tayinlash, MFA reset | majburiy |
| `ADMIN` | administrator | SUPPORT/VET/FARMER ustida: yaratish, rol, bloklash, arxiv, sessiyalar | majburiy |
| `SUPPORT` | qo‘llab-quvvatlash | foydalanuvchilarni ko‘rish (har ko‘rish audit qilinadi) | — |
| `VET` | veterinar | dori/protokol yaratish va **tasdiqlash** (faqat VET) | — |
| `FARMER` | fermer | o‘z fermalari, hayvonlari, ombori, davolashlari, fayllari | — |

Qoidalar: o‘zi ustida admin amali yo‘q (SUPER_ADMIN o‘z rolini pasaytira
olmaydi); ADMIN boshqa ADMIN/SUPER_ADMIN ustida amal qila olmaydi; oxirgi faol
SUPER_ADMIN’ni pasaytirib/bloklab/arxivlab bo‘lmaydi; rol o‘zgarsa target’ning
barcha sessiyalari darhol bekor qilinadi. Ro‘yxatdan o‘tish faqat `FARMER`
yaratadi (`role` maydoni yuborilsa 400). Statuslar: `PENDING_VERIFICATION`,
`ACTIVE`, `BLOCKED`, `ARCHIVED` (hard delete yo‘q).

Birinchi SUPER_ADMIN production’da CLI bilan yaratiladi (parol faqat stdin’dan):

```sh
BOOTSTRAP_PHONE=+998901234567 BOOTSTRAP_FULL_NAME='Ism Familiya' npm run admin:create
```

## Auth oqimlari

Barcha yo‘llar `/api/v1/auth` ostida.

**Ro‘yxatdan o‘tish:** `POST /register {phone, fullName, password}` → har doim
`202 {verificationId, expiresIn, message}` (telefon mavjudligi oshkor
qilinmaydi) → SMS’dagi kod → `POST /verify-phone {verificationId, code}` →
akkaunt `ACTIVE`. Kodni qayta yuborish: `POST /otp/resend` (cooldown, limit).

**Login:** `POST /login {phone, password}`:

- `FARMER`/`SUPPORT`/`VET` → `{status: 'AUTHENTICATED', accessToken, user}`;
- `ADMIN`/`SUPER_ADMIN`, MFA sozlanmagan → `{status: 'MFA_SETUP_REQUIRED', mfaToken}`
  → `POST /mfa/setup {mfaToken}` (secret + `otpauth://` URL, QR uchun) →
  `POST /mfa/enable {mfaToken, code}` → sessiya;
- MFA sozlangan → `{status: 'MFA_REQUIRED', mfaToken}` → `POST /mfa/verify {mfaToken, code}`.

Xatolar: noto‘g‘ri telefon yoki parol — bir xil `401 INVALID_CREDENTIALS`;
ko‘p urinish — `429 ACCOUNT_LOCKED` + `Retry-After`; tasdiqlanmagan telefon —
`403 PHONE_NOT_VERIFIED`; bloklangan — `403 ACCOUNT_BLOCKED`.

**Token’lar:**

- access token (default 15 daqiqa) faqat `Authorization: Bearer` header’da;
- web: refresh token `HttpOnly; Secure; SameSite=Strict` cookie
  (`__Secure-mf_rt`, `Path=/api/v1/auth`) + CSRF cookie (`__Host-mf_csrf`) —
  `POST /refresh` va cookie bilan `POST /logout` `X-CSRF-Token` header’ini
  talab qiladi;
- mobil: `X-Client-Type: mobile` → refresh token JSON body’da, `POST /refresh {refreshToken}`;
- har refresh’da token almashadi; eski refresh token qayta ishlatilsa butun
  token oilasi (sessiya) yopiladi va `401`.

**Sessiyalar:** `POST /logout`, `POST /logout-all`, `GET /sessions`,
`DELETE /sessions/:id`, `GET /me`.

**Parol:** `POST /password/forgot {phone}` (bir xil `202`) →
`POST /password/reset {verificationId, code, newPassword}` (barcha sessiyalar
bekor); `POST /password/change {currentPassword, newPassword}` (boshqa
sessiyalar bekor). Parol siyosati: 8–128 belgi, kamida bitta harf va raqam,
telefon raqamini o‘z ichiga olmaydi.

## API

Bazaviy manzil: `http://localhost:3001/api/v1`. Swagger: `/docs`
(`SWAGGER_ENABLED=true` bo‘lsa; production’da default o‘chiq).

| Prefiks | Rollar | Tavsif |
| --- | --- | --- |
| `GET /health`, `GET /health/live` | public | holat (`up`/`down`), liveness |
| `/auth/*` | public / barcha rollar | yuqoridagi oqimlar |
| `/admin/users/*` | SUPER_ADMIN, ADMIN (ko‘rish: + SUPPORT) | foydalanuvchilar: ro‘yxat, ko‘rish, yaratish, rol, block/unblock, archive, sessiyalar, MFA reset |
| `/admin/audit-logs` | SUPER_ADMIN, ADMIN | audit log (faqat o‘qish, paginated) |
| `/farms`, `/animals` | FARMER | o‘z fermalari va hayvonlari (archive, DELETE yo‘q) |
| `/inventory/items`, `/inventory/items/:id/movements` | FARMER | ombor; harakatlar `Idempotency-Key` bilan |
| `/vet/medicines`, `/vet/protocols` | VET, ADMIN, SUPER_ADMIN (yozish); FARMER faqat tasdiqlanganini ko‘radi | dori va protokollar, versiyalar, tasdiqlash (faqat VET) |
| `/vet/recommendations` | FARMER, VET | faqat tasdiqlangan protokollar; emergency’da dori tavsiya qilinmaydi |
| `/vet/treatments` | FARMER | davolash (snapshot, withdrawal), `Idempotency-Key` |
| `/files` | barcha rollar (faqat o‘z fayllari) | upload, metadata, content, signed URL, soft delete |
| `POST /sms/webhook/delivery` | public (HMAC imzo) | SMS yetkazish hisobotlari |
| `GET /dev/sms-inbox` | faqat development + mock SMS | lokal OTP’larni ko‘rish |

Har ro‘yxat endpoint’i paginated (`page`, `limit`, allowlist’dagi `sort`).
Xato javobi: `{statusCode, code, message, requestId}` (xabarlar o‘zbekcha).

## Tez start (development)

Talab: Docker (Compose v2) va Node.js 22+. Buyruqlar repo ildizidan:

```sh
cp apps/backend/.env.example apps/backend/.env   # dev qiymatlar
npm ci                                           # root lockfile
npm run start:dev                                # = docker compose -f apps/backend/compose.dev.yaml up --build
```

`npm run dev:up` — xuddi shu, lekin fonda: API healthcheck’i (`/api/v1/health`)
o‘tguncha kutadi, xato bo‘lsa API loglarining oxirini chiqaradi. Root’dagi
`npm run start:dev:all` shundan keyin frontend’ni ham ishga tushiradi.

`api` container PostgreSQL’ni kutadi, `prisma migrate deploy` bajaradi,
`DEMO_ACCOUNTS_ENABLED=true` bo‘lsa demo seed’ni yuritadi va `nest start --watch`
bilan ishga tushadi. Seed xato bersa container to‘xtaydi (masalan, dev baza demo
akkauntlarning eski tartibi bilan yaratilgan bo‘lsa — `npm run dev:reset`).
Repo `/repo` ga bind mount qilingan (hot reload), `node_modules` alohida
volume’larda.

| Servis | Manzil |
| --- | --- |
| API | http://localhost:3001/api/v1 |
| Swagger | http://localhost:3001/docs |
| Dev SMS inbox | http://localhost:3001/api/v1/dev/sms-inbox |
| MinIO konsol | http://localhost:9001 (`minioadmin` / `minioadmin`, faqat dev) |
| PostgreSQL | localhost:5432 (`postgres` / `1234`, faqat dev) |
| Redis | localhost:6379 |

Barcha portlar faqat `127.0.0.1` ga bog‘langan; band bo‘lsa `.env` da
`API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`.
Yangi PostgreSQL volume’da `docker/postgres/init/01-roles.sh` runtime rol
`meningfermam_app` va `meningfermam_test` bazasini yaratadi
([`docs/operations/database.md`](docs/operations/database.md)). Volume bu
skriptdan oldin yaratilgan bo‘lsa, ular yo‘q — `npm run dev:reset` bilan qayta
yarating.

Host’dan Prisma: `DATABASE_URL=postgresql://postgres:1234@localhost:5432/meningfermam?schema=public npx prisma migrate dev`
(`apps/backend` papkasida).

## Demo akkauntlar

Faqat development/test. Hammasi `.env` dan olinadi — kodda telefon/parol yo‘q:

| Rol | Telefon | Email | Parol (env) |
| --- | --- | --- | --- |
| SUPER_ADMIN | `DEMO_SUPER_ADMIN_PHONE` (dev: `+998900000001`) | `DEMO_SUPER_ADMIN_EMAIL` | `DEMO_SUPER_ADMIN_PASSWORD` |
| FARMER | `DEMO_FARMER_PHONE` (dev: `+998900000002`) | `DEMO_FARMER_EMAIL` | `DEMO_FARMER_PASSWORD` |
| ADMIN | `+998000000001` | — | `DEMO_PASSWORD` |
| SUPPORT | `+998000000002` | — | `DEMO_PASSWORD` |
| VET | `+998000000003` | — | `DEMO_PASSWORD` |
| FARMER (2) | `+998000000004` | — | `DEMO_PASSWORD` |

Dev qiymatlari `.env.example` da. `+998000000…` — mavjud bo‘lmagan operator
kodi, real odamga tegishli bo‘la olmaydi. Demo SUPER_ADMIN va ADMIN birinchi
login’da TOTP MFA sozlaydi (authenticator ilova kerak).

Seed (`npm run db:seed`, `prisma/seed.ts`):

- avval "Molim kasal" kasalliklar ma’lumotnomasini yuklaydi (demo emas,
  ma’lumotnoma: `prisma/data/kasalliklar-manba.txt` so‘zma-so‘z; o‘sha kalit
  va checksum bo‘lsa hech narsa qilmaydi, checksum boshqa bo‘lsa xato bilan
  to‘xtaydi — saqlangan matn hech qachon ustidan yozilmaydi);

- `NODE_ENV` `development`/`test` bo‘lmasa (production) hech narsa yuklamasdan
  xato bilan to‘xtaydi; `.env` ichidagi `NODE_ENV` ham tekshiriladi;
- `DEMO_ACCOUNTS_ENABLED=true` bo‘lmasa "o‘tkazib yuborildi" deb chiqadi (exit 0);
- `DEMO_PASSWORD` majburiy (≥ 12 belgi, harf + raqam), standart parol yo‘q;
  `*_PHONE` berilmagan env akkaunt o‘tkazib yuboriladi;
- hammasi bitta transaction’da: telefon yoki email demo bo‘lmagan akkauntga
  tegishli bo‘lsa — hech narsa yozilmaydi;
- idempotent: qayta ishga tushganda dublikat yaratmaydi; parol o‘zgargan bo‘lsa
  yangilaydi va sessiyalarni bekor qiladi;
- demo ferma, hayvonlar, ombor (boshlang‘ich qoldiq ledger orqali) faqat demo
  fermerlarga; demo dori va protokol `DRAFT`, `isDemo`, nomida
  `DEMO — klinik tasdiqlanmagan` (DB ularni tasdiqlashga yo‘l qo‘ymaydi);
- parollar hech qachon chiqarilmaydi.

## Testlar

```sh
cd apps/backend
npm test                     # unit (src/**/*.spec.ts, test/**/*.spec.ts)
npm run typecheck && npm run lint && npm run format:check
```

E2E testlar haqiqiy PostgreSQL + Redis bilan (`test/**/*.e2e-spec.ts`):

```sh
TEST_DATABASE_URL=postgresql://postgres:1234@localhost:5432/meningfermam_test \
TEST_REDIS_URL=redis://127.0.0.1:6379/1 \
npm run test:e2e
```

- baza nomi `<nom>_test` yoki `<nom>_test_<suffiks>` bo‘lishi, Redis esa
  noldan farqli DB indeksi bo‘lishi shart (aks holda testlar ishlamaydi);
- global setup `prisma migrate deploy` bajaradi; baza runlar orasida
  **tozalanmaydi** (testlar faqat o‘zi yaratgan qatorlarni tekshiradi).
  Toza baza kerak bo‘lsa (faqat odam yoki CI): `TEST_DB_RESET=true`;
- bitta baza/Redis jufti uchun bir vaqtda bitta e2e run;
- `.env` testlarda o‘qilmaydi; muhit `test/setup/env.ts` da;
- `TEST_LOGS=stdout` — ilova loglarini ko‘rsatadi.

Security testlar: `test/security/` (ro‘yxat:
[`docs/security/overview.md#security-testlar`](docs/security/overview.md#security-testlar)),
infra testlari: `test/infra/` (Dockerfile, `.gitignore`, `.env.example`, CI
pin’lari, demo seed).

## Environment o‘zgaruvchilari

To‘liq ro‘yxat, dev qiymatlar va secret yaratish buyruqlari —
[`.env.example`](.env.example); sxema — `src/config/env.ts`.

| Guruh | O‘zgaruvchilar | Izoh |
| --- | --- | --- |
| Asosiy | `NODE_ENV`, `PORT` | `development` / `test` / `production` |
| DB / cache | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL` | runtime — `meningfermam_app`; migratsiya — sxema egasi (`prisma.config.ts`) |
| HTTP | `TRUST_PROXY`, `CORS_ORIGINS`, `HTTPS_REQUIRED`, `HSTS_MAX_AGE_SECONDS`, `BODY_LIMIT`, `SWAGGER_ENABLED` | `TRUST_PROXY=true` va CORS `*` rad etiladi |
| Log | `LOG_LEVEL`, `LOG_PRETTY` | production’da faqat JSON |
| Rate limit | `RATE_LIMIT_GLOBAL_PER_MINUTE`, `LOGIN_RATE_LIMIT_PER_IP`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_SECONDS`, `MFA_MAX_ATTEMPTS` | |
| JWT | `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_*_SECRETS_PREVIOUS`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `MFA_TOKEN_TTL_SECONDS` | secret’lar ≥ 32 belgi, har xil |
| Cookie | `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_DOMAIN`, `AUTH_COOKIE_SAMESITE` | production’da Secure majburiy |
| Parol / OTP / MFA | `PASSWORD_SCRYPT_COST`, `OTP_PEPPER`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_SENDS`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEYS_PREVIOUS`, `MFA_ISSUER` | |
| SMS | `SMS_PROVIDER`, `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`, `SMS_ALLOWED_HOSTS`, `SMS_WEBHOOK_SECRET`, `SMS_DAILY_LIMIT_PER_PHONE`, `SMS_DAILY_LIMIT_PER_IP`, `SMS_MAX_SEND_ATTEMPTS` | production’da `mock` taqiqlangan |
| Storage | `STORAGE_DRIVER`, `S3_*`, `UPLOAD_LOCAL_DIR`, `UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_FILES_PER_USER`, `UPLOAD_USER_QUOTA_BYTES`, `UPLOAD_STRIP_METADATA` | production’da faqat `s3` |
| Idempotency | `IDEMPOTENCY_TTL_SECONDS` | |
| Demo (dev/test) | `DEMO_ACCOUNTS_ENABLED`, `DEMO_PASSWORD`, `DEMO_SUPER_ADMIN_{PHONE,EMAIL,PASSWORD}`, `DEMO_FARMER_{PHONE,EMAIL,PASSWORD}` | production’da rad etiladi |
| Telemetriya | `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET` | ikkalasi bo‘lsa yoqiladi |

## Komandalar

`apps/backend` ichida (yoki root’dan `npm run <nom> -w apps/backend`):

| Komanda | Vazifasi |
| --- | --- |
| `npm run start:dev` | dev stack’ni build qilib ko‘tarish (Docker) |
| `npm run dev:up` | xuddi shu, fonda; API sog‘lom bo‘lguncha kutadi |
| `npm run dev:logs` / `dev:restart` / `dev:down` | API loglari / restart / to‘xtatish |
| `npm run dev:reset` | to‘xtatish va **barcha dev volume’larni o‘chirish** |
| `npm run build` / `start:prod` | production build / ishga tushirish |
| `npm run typecheck` / `lint` / `format` / `format:check` | sifat tekshiruvlari |
| `npm test` / `test:e2e` / `test:cov` | testlar |
| `npm run ci` | typecheck + lint + unit |
| `npm run audit:deps` | `npm audit --audit-level=high` |
| `npm run db:migrate` | yangi migratsiya (faqat dev) |
| `npm run db:deploy` | migratsiyalarni qo‘llash (`MIGRATION_DATABASE_URL`) |
| `npm run db:seed` | kasalliklar ma’lumotnomasi + demo seed (faqat dev/test) |
| `npm run db:seed:diseases` | faqat kasalliklar ma’lumotnomasi (idempotent; production’da `node dist/cli/seed-diseases.js`) |
| `npm run admin:create` | birinchi SUPER_ADMIN (build’dan keyin) |

## Production

Qisqacha: image repo ildizidan build qilinadi
(`docker build -f apps/backend/Dockerfile .`), release bosqichida
`docker compose -f compose.prod.yaml run --rm migrate`, keyin `up -d api`.
Container root emas (`10001`), read-only, `cap_drop: ALL`, faqat
`127.0.0.1` ga bog‘langan, reverse proxy (TLS) ortida, secret’lar serverdagi
env fayldan. Seed va demo akkauntlar production’da mavjud emas.

Batafsil: [`docs/operations/deployment.md`](docs/operations/deployment.md).

## Hujjatlar

- [`docs/security/overview.md`](docs/security/overview.md) — tahdid modeli, talablar → kod
- [`docs/operations/deployment.md`](docs/operations/deployment.md) — proxy, TLS, security group, release
- [`docs/operations/database.md`](docs/operations/database.md) — least-privilege rollar, TLS, UTC
- [`docs/operations/backup-restore.md`](docs/operations/backup-restore.md) — backup, PITR, oylik restore testi
- [`docs/operations/secrets.md`](docs/operations/secrets.md) — secret’lar va rotatsiya runbook’lari
