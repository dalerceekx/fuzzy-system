# Secret’lar

## Qoidalar

- Secret’lar **faqat** environment orqali keladi; production’da manba — AWS
  Secrets Manager (yoki SSM Parameter Store SecureString).
- Git’ga, image’ga, `compose.prod.yaml` ga, loglarga, audit log’ga va API
  javoblariga hech qachon yozilmaydi. `.gitignore` / `.dockerignore` `.env*`,
  kalit va dump fayllarini chiqarib tashlaydi; CI’da gitleaks butun tarixni
  tekshiradi.
- `.env.example` dagi qiymatlar faqat development uchun (`dev-only-…`);
  production `validateEnv` mock SMS, demo akkaunt, demo parol, `LOG_PRETTY`,
  Secure bo‘lmagan cookie va kuchsiz scrypt’ni rad etadi.
- Production env fayli serverda `root:root 0600`, faqat API container’iga
  `env_file` orqali beriladi.

```sh
aws secretsmanager get-secret-value \
  --secret-id meningfermam/api/production \
  --query SecretString --output text \
  | jq -r 'to_entries[] | "\(.key)=\(.value)"' \
  | sudo install -m 600 -o root -g root /dev/stdin /etc/meningfermam/api.env
```

Migratsiya uchun alohida `/etc/meningfermam/migrate.env` (faqat
`MIGRATION_DATABASE_URL`, `NODE_ENV=production`) — API env faylida sxema egasi
paroli bo‘lmaydi.

## Secret’lar ro‘yxati

| O‘zgaruvchi | Nima uchun | Yaratish |
| --- | --- | --- |
| `JWT_ACCESS_SECRET` | access token imzosi (HS256) | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | refresh token imzosi (alohida) | `openssl rand -base64 48` |
| `OTP_PEPPER` | OTP kodlarining HMAC kaliti (DB sizsa ham kodni brute-force qilib bo‘lmaydi) | `openssl rand -base64 48` |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM: TOTP secret’lar, navbatdagi SMS payload | `openssl rand -base64 32` |
| `SMS_API_KEY` | SMS provayder | provayder kabinetidan |
| `SMS_WEBHOOK_SECRET` | delivery webhook HMAC | `openssl rand -hex 32` |
| `DATABASE_URL` | `meningfermam_app` paroli | `openssl rand -base64 32` |
| `MIGRATION_DATABASE_URL` | sxema egasi paroli (faqat release) | `openssl rand -base64 32` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | production’da **bo‘sh** — IAM task role | — |

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_PEPPER` bir-biridan farq qilishi
shart (aks holda ilova ishga tushmaydi).

## Rotatsiya runbook’lari

Har bir secret uchun: yangi qiymatni secret manager’da yarating → env faylni
qayta chiqaring → API’ni rolling restart qiling → natijani tekshiring →
eski qiymatni olib tashlang. Har bir rotatsiya ticket/jurnalda qayd etiladi.

### JWT (rejali, foydalanuvchilarni chiqarmasdan)

Token header’idagi `kid` = secret’ning sha256 bo‘yicha qisqa identifikatori;
birinchi secret imzolaydi, ro‘yxatdagi hammasi tekshiradi.

1. `JWT_ACCESS_SECRETS_PREVIOUS=<eski access>` va
   `JWT_REFRESH_SECRETS_PREVIOUS=<eski refresh>` qo‘shing, `JWT_*_SECRET` ga
   yangi qiymat yozing; deploy.
2. Access uchun `JWT_ACCESS_TTL_SECONDS` (default 15 daqiqa), refresh uchun
   `JWT_REFRESH_TTL_SECONDS` (default 30 kun) o‘tgach `*_PREVIOUS` dan eski
   qiymatni olib tashlang; deploy.

### JWT (sizib chiqqan — favqulodda)

`*_PREVIOUS` ga **qo‘shmasdan** yangi secret qo‘ying va deploy qiling: barcha
eski tokenlar darhol yaroqsiz (hamma qayta login qiladi). Kerak bo‘lsa
`sessions` jadvalidagi faol sessiyalarni ham bekor qiling.

### `OTP_PEPPER`

Faqat bitta qiymat qo‘llanadi. Almashtirilganda hozir amal qilayotgan OTP
kodlar (ko‘pi bilan `OTP_TTL_SECONDS`, default 5 daqiqa) yaroqsiz bo‘ladi —
foydalanuvchi kodni qayta so‘raydi. Kam trafik vaqtida bajaring.

### `DATA_ENCRYPTION_KEY`

1. Yangi kalit → `DATA_ENCRYPTION_KEY`, eski →
   `DATA_ENCRYPTION_KEYS_PREVIOUS` (deshifrlash uchun saqlanadi); deploy.
2. Shifrlangan qiymatlarda kalit identifikatori (`v1.<kid>.…`) bor, yangi
   yozuvlar yangi kalit bilan shifrlanadi. Eski kalit bilan shifrlangan TOTP
   secret’lar qayta shifrlanmaguncha (yoki MFA qayta sozlanmaguncha)
   `*_PREVIOUS` dan eski kalitni **olib tashlamang** — aks holda MFA ishlamay
   qoladi. Eski kalit bilan qolgan yozuvlar sonini tekshirish:
   `SELECT count(*) FROM users WHERE mfa_secret_enc LIKE 'v1.<eski-kid>.%';`

### `SMS_API_KEY`, `SMS_WEBHOOK_SECRET`

Provayder kabinetida yangi kalit yarating, env’ni yangilang, deploy, eski
kalitni provayderda o‘chiring. Webhook secret’i provayder bilan bir vaqtda
almashtiriladi (oraliqda kelgan hisobotlar 401 oladi va provayder qayta
yuboradi).

### Ma’lumotlar bazasi parollari

`ALTER ROLE meningfermam_app PASSWORD '…'` (psql `\password`), secret
manager’ni yangilang, API’ni restart qiling. RDS IAM authentication ishlatish
ham mumkin (parolsiz, 15 daqiqalik token).

## Demo secret’lar

`DEMO_PASSWORD`, `DEMO_SUPER_ADMIN_PASSWORD`, `DEMO_FARMER_PASSWORD` faqat
development/test uchun. Production `validateEnv` `DEMO_ACCOUNTS_ENABLED=true` va
`DEMO_PASSWORD` ni rad etadi, demo seed esa `NODE_ENV=production` da darhol
to‘xtaydi va image ichida umuman yo‘q.
