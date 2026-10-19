# Xavfsizlik: tahdid modeli va talablarning bajarilishi

> Holat: platforma qatlami (`src/common`, `src/security`, `src/audit`,
> `src/idempotency`, `src/storage`, `src/logging`, `src/prisma`, `src/redis`,
> `src/app.setup.ts`), DB constraint’lari va infra (Docker, CI, seed) tayyor.
> Funksional modullar (`auth`, `users`, `sms`, `files`, `farms`/`animals`,
> `inventory`, `vet`) parallel yozilmoqda — ular haqidagi qatorlar loyiha
> kontraktiga asoslangan va integratsiya bosqichida e2e testlar bilan qayta
> tasdiqlanadi.

## Tahdid modeli (qisqa)

| Aktor | Maqsadi | Asosiy himoya |
| --- | --- | --- |
| Internetdagi anonim hujumchi | akkaunt egallash (brute-force, credential stuffing), telefon raqam enumeratsiyasi, SMS bombing | per-IP va per-akkaunt rate limit, lockout, bir xil javoblar, kunlik SMS kvota, OTP cheklovlari |
| Ro‘yxatdan o‘tgan fermer | boshqa fermer ma’lumotiga kirish (IDOR), rolni oshirish, ombor qoldig‘ini buzish | har so‘rovda DB’dan joriy rol, ownership `where` ichida, 404, DTO whitelist, transaction + CHECK |
| O‘g‘irlangan token | uzoq muddatli kirish | qisqa access token, refresh rotation + reuse detection, rol o‘zgarsa/parol tiklansa sessiyalar bekor |
| Zararli fayl | XSS/RCE, path traversal, disk to‘ldirish | MIME + magic bytes + extension, SVG/HTML/exe rad, UUID kalit, kvota, private bucket |
| Insider / support operatori | ma’lumotni izsiz ko‘rish/o‘zgartirish | append-only audit log (trigger + grant), ADMIN ≠ SUPER_ADMIN ierarxiyasi |
| Ta’minot zanjiri | zararli dependency, sizgan secret | lockfile + `npm ci`, `npm audit`, gitleaks, semgrep, Trivy, SHA bilan pin qilingan action’lar |
| Infratuzilma | ochiq port, root container, image ichidagi secret | private subnet, loopback bind, non-root read-only container, secret’lar faqat env’dan |

## Talablar → amalga oshirish

### Auth va akkaunt

| Talab | Qanday | Joy |
| --- | --- | --- |
| ADMIN/SUPER_ADMIN uchun MFA majburiy | `MFA_REQUIRED_ROLES`; MFA’siz sessiya bu rollar uchun ishlamaydi (`AccessTokenGuard`); login → `MFA_SETUP_REQUIRED`/`MFA_REQUIRED` | `src/common/auth/roles.ts`, `src/security/guards/access-token.guard.ts`, `src/auth/mfa/` |
| Telefon tasdiqlanmaguncha akkaunt faol emas | `PENDING_VERIFICATION` → OTP → `ACTIVE`; DB: `users_active_requires_verified_phone_chk` | `src/auth/`, migratsiya |
| OTP faqat hash | `HMAC-SHA256(OTP_PEPPER, id:code)`, `code_hash` CHECK (64 hex) | `src/auth/otp.service.ts`, `src/security/crypto.ts` |
| OTP bir martalik, qisqa, urinish cheklangan | atomik `attempts+1` UPDATE, `consumed_at` bir marta, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`; bitta jonli kod (partial unique index) | `src/auth/otp.service.ts` |
| Resend cooldown | `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_SENDS`, 429 + `Retry-After` | `src/auth/` |
| Login: IP va akkaunt bo‘yicha alohida limit | `rl:login:ip:*` va `rl:login:fail:<hash(phone)>`; Redis ishlamasa **fail-closed** | `src/security/rate-limit.service.ts`, `src/auth/login.service.ts` |
| Ko‘p xato paroldan keyin bloklash | `LOGIN_MAX_FAILED_ATTEMPTS` → `LOGIN_LOCKOUT_SECONDS`, 429 `ACCOUNT_LOCKED` | `src/auth/login.service.ts` |
| Telefon mavjudligini oshkor qilmaslik | register/forgot har doim bir xil `202`; noma’lum telefon uchun ham scrypt (timing) | `src/auth/`, `src/security/password.ts` (`padVerification`) |
| Parol reset barcha sessiyalarni bekor qiladi | bitta transaction: OTP consume + yangi hash + `PASSWORD_RESET` revoke | `src/auth/` |
| scrypt/Argon2id | scrypt (N=65536 default, production ≥ 32768), parametrlar hash ichida, `needsRehash` | `src/security/password.ts` |
| Refresh rotation + reuse detection | `Session` = token oilasi, `currentRefreshJti` atomik almashadi; eski jti → butun oila `REFRESH_TOKEN_REUSE` bilan yopiladi | `src/security/sessions/session.service.ts` |
| JWT: iss, aud, sub, sid, exp | `TokenService` hammasini tekshiradi, faqat HS256 + ma’lum `kid`, UUID formatlari | `src/security/tokens/token.service.ts` |
| Access va refresh uchun alohida secret, rotatsiya | `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`, `*_PREVIOUS` ro‘yxatlari, `kid` header | `src/config/env.ts`, `docs/operations/secrets.md` |
| JWT payload’da maxfiy ma’lumot yo‘q | faqat `sub`, `sid`, `typ`, `jti`, `iat`, `exp` — rol ham yo‘q | `src/security/tokens/token.service.ts` |
| Refresh token: HttpOnly Secure SameSite cookie | web: `__Secure-mf_rt` (Path `/api/v1/auth`), mobil: body | `src/auth/auth-cookies.ts` |
| Cookie bo‘lsa CSRF | `__Host-mf_csrf` + `X-CSRF-Token` (double submit, `safeEqual`) + Origin allowlist | `src/auth/` |

### Authorization

| Talab | Qanday | Joy |
| --- | --- | --- |
| Har endpoint auth/role/ownership | global guard’lar: rate limit → `AccessTokenGuard` → `RolesGuard`; har route’da aniq bitta `@Public()` yoki `@Roles()`, aks holda 403 (fail-closed); test: `test/platform/route-guards.e2e-spec.ts` | `src/app.platform.ts`, `src/security/guards/` |
| ID yetarli emas; begona resurs → 404 | ownership shart Prisma `where` ichida (`farm: { ownerId }`), topilmasa ham, begona bo‘lsa ham bir xil 404 | domen servislar |
| Rol o‘zgarsa sessiyalar darhol bekor | bitta transaction’da `ROLE_CHANGED` revoke; guard har so‘rovda sessiya + joriy rolni DB’dan o‘qiydi | `src/users/`, `src/security/guards/access-token.guard.ts` |
| SUPER_ADMIN o‘z rolini pasaytira olmaydi | o‘ziga admin amali → 403 `SELF_ACTION_FORBIDDEN` | `src/users/` |
| Oxirgi faol SUPER_ADMIN | advisory lock + 409 `LAST_SUPER_ADMIN`; DB deferred trigger zaxira | `src/users/`, migratsiya |
| ADMIN boshqa ADMIN/SUPER_ADMIN ustida amal qila olmaydi | servisda actor va target `FOR UPDATE` bilan qayta o‘qiladi | `src/users/` |
| Muhim amallarda DB’dagi joriy rol | guard + transaction ichida qayta tekshirish; dori/protokol tasdiqlashni DB trigger ham faqat joriy `VET` ga ruxsat beradi | `src/security/`, `src/vet/`, migratsiya |

### Audit log

- `audit_logs`: `actorId`, `actorRole`, `action`, `resourceType`, `resourceId`,
  `oldValue`, `newValue`, `ip`, `userAgent`, `requestId`, `timestamp`.
- O‘zgartirib/o‘chirib bo‘lmaydi: `audit_logs_append_only` va
  `audit_logs_no_truncate` trigger’lari + runtime rolda faqat
  `SELECT, INSERT`.
- Yoziladigan amallar ro‘yxati: `src/audit/audit-actions.ts` (login/failed
  login, password reset, role o‘zgarishi, bloklash, logout-all, dori/protokol
  tasdiqlash, ombor kirim-chiqimi, hayvon arxivlash, `user.viewed` — support
  operatorining ko‘rishi va boshqalar).
- Sanitizer parol, OTP, token, secret, API key va shunga o‘xshash kalitlarni
  `[REDACTED]` qiladi: `src/audit/audit-sanitize.ts`.

### Fayl yuklash

MIME + magic bytes (`file-type`) + extension uchalasi mos bo‘lishi; faqat
JPEG/PNG/WebP/PDF; SVG/HTML/script/executable imzolari rad; fayl nomi server
yaratadigan UUID kalit (`buildStorageKey`), original nom faqat ko‘rsatish uchun
tozalanadi; local driver yo‘lni base papkadan chiqib ketmasligini va symlink’ni
tekshiradi; hajm (`UPLOAD_MAX_FILE_BYTES` → 413), soni va per-user kvota;
upload papkasi loyiha papkasidan tashqarida bo‘lishi startup’da tekshiriladi;
production’da faqat `s3` (private bucket, MinIO dev’da `anonymous none`);
olish — ownership tekshiradigan endpoint yoki qisqa muddatli signed URL;
`MalwareScanner` interfeysi; EXIF/metadata tozalash.
Joy: `src/storage/`, `src/files/`.

### API va input

- Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `forbidUnknownValues`, implicit conversion yo‘q): `src/app.setup.ts`.
- Har `@IsString()` da `@MaxLength()` — `test/platform/dto-max-length.spec.ts`.
- Pagination majburiy va limitli, sort faqat allowlist’dan:
  `src/common/pagination/`. Foydalanuvchidan `where`/`orderBy`/raw SQL
  qabul qilinmaydi; raw SQL faqat tagged template (`$queryRaw`) — semgrep
  qoidasi `$queryRawUnsafe` ni taqiqlaydi (`.semgrep.yml`).
- Decimal: `@IsDecimalString`, hisoblar `Prisma.Decimal`, pul/ombor
  `Decimal` ustunlar; `null`/NaN/Infinity rad: `src/common/validation/`.
- UUID validatsiyasi (`id-param.decorator.ts`), body limiti `BODY_LIMIT` → 413.
- Idempotency: `(userId, scope, key)` unique, so‘rov hash’i; boshqa payload →
  409; javob operatsiya bilan bir transaction’da saqlanadi:
  `src/idempotency/`.
- Parallel ombor amallari: row lock + transaction + `quantity >= 0` CHECK.

### Ma’lumotlar bazasi

Constraint, index, trigger va least-privilege grant’lar migratsiyada;
batafsil: [`../operations/database.md`](../operations/database.md).
Backup/restore: [`../operations/backup-restore.md`](../operations/backup-restore.md).

### SMS

API key faqat env’dan; loglarda telefon `maskPhone()`, OTP va SMS matni
yozilmaydi; kunlik per-telefon/per-IP kvota; webhook HMAC imzo + timestamp +
replay himoyasi; provayder URL’i `https` va host `SMS_ALLOWED_HOSTS` da
bo‘lishi; Redis navbat (payload shifrlangan), SMS commit’dan keyin yuboriladi —
xato transaction’ni buzmaydi. Joy: `src/sms/`.

### HTTP va infratuzilma

| Talab | Qanday |
| --- | --- |
| Faqat HTTPS | `HTTPS_REQUIRED` (production default) → 403; HTTP→HTTPS redirect proxy’da |
| Trusted proxy aniq | `TRUST_PROXY` validatsiyasi (`true`, `/0`, hostname rad) — `src/app.setup.ts` |
| Helmet, HSTS faqat production HTTPS | `buildHelmetOptions` |
| CORS wildcard yo‘q | aniq allowlist, `*` env darajasida rad |
| Swagger production’da o‘chiq | `SWAGGER_ENABLED` default `false` |
| `/health` sir oshkor qilmaydi | faqat `up`/`down` |
| Xatoda stack/SQL/path/secret yo‘q | `AllExceptionsFilter`, DB xatolari kod bo‘yicha xaritalanadi |
| requestId | har so‘rovga; `X-Request-Id` faqat trusted proxy’dan qabul qilinadi |
| Structured JSON log + redaction | pino; Authorization, Cookie, parol, OTP, token’lar `[REDACTED]` — `src/logging/` |
| Graceful shutdown | `enableShutdownHooks`, 503 on closing, Prisma/Redis yopiladi |
| Non-root, minimal, multi-stage, read-only container; secret’lar image’da yo‘q; port’lar ochiq emas | `Dockerfile`, `compose.prod.yaml`, [`deployment.md`](../operations/deployment.md); statik test: `test/infra/dockerfile.spec.ts` |

### Ta’minot zanjiri

`save-exact=true` (`.npmrc`), bitta root lockfile, faqat `npm ci`; CI
(`.github/workflows/ci.yml`): typecheck, lint, format, unit, e2e,
`npm audit --audit-level=high` (high/critical → build to‘xtaydi), gitleaks
(butun tarix, `--redact`), semgrep (`p/default`, `p/nodejs`, `p/typescript`,
`p/secrets` + loyiha qoidalari), Docker build + Trivy (HIGH/CRITICAL →
to‘xtaydi); CodeQL; action’lar commit SHA bilan pin qilingan; Dependabot
haftalik. `.gitignore`: `.env*`, uploads, dump, backup, kalitlar —
`test/infra/gitignore.spec.ts` tekshiradi.

### Biznes va veterinariya

Tasdiqlanmagan dori/protokol fermerga ko‘rsatilmaydi; tasdiqlashni faqat
`VET` (DB trigger ham); tasdiqlangan versiya o‘zgarmaydi — yangi versiya;
emergency holatda avtomatik dori tavsiya qilinmaydi; davolash boshlanganda doza,
vazn va protokol snapshot qilinadi (`treatment_doses` append-only); muddat,
ochilgandan keyingi muddat va withdrawal tekshiriladi. Joy: `src/vet/`,
migratsiya.

### Demo

- `DEMO_ACCOUNTS_ENABLED=true` va har qanday `DEMO_PASSWORD` production
  `validateEnv` da rad etiladi (`test/infra/env-demo.spec.ts`).
- `prisma/seed.ts` hech narsa yuklamasdan/ulanmasdan oldin
  `NODE_ENV` ni tekshiradi va production’da xato bilan to‘xtaydi
  (`test/security/demo-seed-production.e2e-spec.ts`); seed production image’da
  yo‘q.
- Kodda standart demo parol yo‘q; demo akkauntlar `isDemo`, real akkauntga
  tegilmaydi (to‘qnashuvda butun seed rollback); demo klinik ma’lumotlar
  `DRAFT`, `isDemo` va `DEMO — klinik tasdiqlanmagan` yorlig‘i bilan (DB ularni
  tasdiqlashni taqiqlaydi) — `test/infra/demo-seed.e2e-spec.ts`.

## Security testlar

| Tahdid | Test |
| --- | --- |
| IDOR / ownership | `test/security/idor-*.e2e-spec.ts` |
| Privilege escalation | `test/security/privilege-escalation.e2e-spec.ts` |
| Register orqali role injection | `test/security/register-role-injection.e2e-spec.ts` |
| Eski JWT bilan role bypass | `test/security/stale-jwt-role-bypass.e2e-spec.ts` |
| Refresh token reuse | `test/security/refresh-token-reuse.e2e-spec.ts` |
| Brute-force, rate limit | `test/security/brute-force-rate-limit.e2e-spec.ts` |
| OTP replay | `test/security/otp-replay.e2e-spec.ts` |
| Path traversal | `test/security/path-traversal.e2e-spec.ts` |
| Noto‘g‘ri MIME / magic bytes | `test/security/upload-mime-magic.e2e-spec.ts` |
| Oversized upload | `test/security/upload-oversized.e2e-spec.ts` |
| Negative stock race | `test/security/negative-stock-race.e2e-spec.ts` |
| Idempotency collision | `test/security/idempotency-collision.e2e-spec.ts` |
| Expired/revoked session | `test/security/expired-revoked-session.e2e-spec.ts` |
| Production’da demo seed | `test/security/demo-seed-production.e2e-spec.ts` |
| API javobida maxfiy maydon | `test/security/secret-fields-*.e2e-spec.ts` |
| Loglarda parol/token | `test/security/logs-no-secrets.e2e-spec.ts` |
