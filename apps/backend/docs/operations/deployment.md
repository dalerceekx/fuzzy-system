# Production deploy

## Arxitektura

```
Internet ──443──▶ ALB yoki nginx (TLS, HTTP→HTTPS redirect)
                      │  X-Forwarded-For / X-Forwarded-Proto
                      ▼
               API container (127.0.0.1:3001 yoki private subnet)
                      │ TLS                │ TLS                │ HTTPS (VPC endpoint)
                      ▼                    ▼                    ▼
               RDS PostgreSQL 16     ElastiCache Redis 7     S3 (private bucket)
               (private subnet)      (private subnet)
```

- Faqat proxy internetga ochiq (443, 80 faqat redirect uchun).
- API porti, PostgreSQL (5432) va Redis (6379) **hech qachon** internetga
  ochilmaydi: `compose.prod.yaml` API’ni faqat `127.0.0.1` ga bog‘laydi,
  bazalar managed servis sifatida private subnet’da.

## Security group’lar

| SG | Inbound | Manba |
| --- | --- | --- |
| `sg-alb` | 443, 80 | `0.0.0.0/0`, `::/0` |
| `sg-api` | 3001 | faqat `sg-alb` |
| `sg-db` | 5432 | faqat `sg-api` va release/backup task SG |
| `sg-redis` | 6379 | faqat `sg-api` |

Outbound: API → `sg-db`, `sg-redis`, S3 VPC endpoint, SMS provayder (443,
egress proxy yoki NAT). SSH o‘rniga SSM Session Manager.

## Reverse proxy

### nginx (bitta host, `compose.prod.yaml` bilan)

```nginx
server {
    listen 80;
    server_name api.meningfermam.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name api.meningfermam.uz;

    ssl_certificate     /etc/letsencrypt/live/api.meningfermam.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.meningfermam.uz/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_tickets off;

    client_max_body_size 11m;      # UPLOAD_MAX_FILE_BYTES + multipart zaxira
    client_body_timeout 30s;
    proxy_read_timeout 60s;
    server_tokens off;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        # Mijoz yuborgan X-Forwarded-For ni qo‘shib emas, almashtirib yozamiz:
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-Id      $request_id;
        proxy_set_header Connection        "";
    }
}
```

API env: `TRUST_PROXY=1` (bitta hop — nginx), `HTTPS_REQUIRED=true`
(production default). HSTS’ni API o‘zi qo‘yadi (`NODE_ENV=production` va
`HTTPS_REQUIRED` bo‘lsa, `HSTS_MAX_AGE_SECONDS`, `includeSubDomains`).

### AWS ALB

- Listener 443 (ACM sertifikati, `ELBSecurityPolicy-TLS13-1-2-2021-06`),
  listener 80 → 301 HTTPS.
- Target group: HTTP 3001, health check `GET /api/v1/health/live`.
- `TRUST_PROXY` = ALB subnet CIDR’lari (masalan `10.0.0.0/20,10.0.16.0/20`)
  yoki `1`. `true` va `/0` ilova tomonidan rad etiladi (mijoz IP’ni soxtalashtira
  olmasin).
- Ixtiyoriy: AWS WAF (rate-based rule, managed rule groups).

### Nima uchun `TRUST_PROXY` muhim

Per-IP rate limit, login lockout, SMS kvota va `req.secure` (HTTPS
majburiyligi) `X-Forwarded-*` ga tayanadi. Proxy ishonchli deb belgilanmasa,
`HTTPS_REQUIRED=true` bilan ilova ishga tushmaydi; ortiqcha ishonilsa — mijoz
IP’ni soxtalashtiradi. Shuning uchun aniq hop soni yoki proxy CIDR beriladi.

## Image va release

```sh
# CI build qiladi (repo root — build context), Trivy tekshiradi
docker build -f apps/backend/Dockerfile -t <registry>/meningfermam-api:<git-sha> .
docker push <registry>/meningfermam-api:<git-sha>

# Serverda
export API_IMAGE=<registry>/meningfermam-api:<git-sha>
docker compose -f compose.prod.yaml run --rm migrate    # 1. release: migratsiya
docker compose -f compose.prod.yaml up -d api           # 2. API
```

- `migrate` alohida env fayldan faqat `MIGRATION_DATABASE_URL` (sxema egasi)
  oladi; API env faylida faqat `meningfermam_app` bor.
- Birinchi o‘rnatishda SUPER_ADMIN yaratish (parol faqat stdin’dan):

  ```sh
  docker compose -f compose.prod.yaml run --rm -T \
    -e BOOTSTRAP_PHONE=+998XXXXXXXXX -e BOOTSTRAP_FULL_NAME='Ism Familiya' \
    api node dist/cli/create-super-admin.js
  ```

  Birinchi login’da TOTP MFA sozlanadi.
- Kasalliklar ma’lumotnomasini ("Molim kasal") yuklash — migratsiyadan keyin
  bir marta (qayta ishga tushirish xavfsiz: o‘zgarishsiz bo‘lsa hech narsa
  qilmaydi; matn o‘zgargan bo‘lsa xato beradi va hech narsa yozmaydi):

  ```sh
  docker compose -f compose.prod.yaml run --rm api node dist/cli/seed-diseases.js
  ```

## Container qattiqlashtirish (`Dockerfile`, `compose.prod.yaml`)

- Multi-stage build, `node:22.x-alpine` (pin qilingan patch), faqat `npm ci`;
  runtime image’da faqat `dist/`, production `node_modules`, `package.json`,
  `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/`,
  `prisma/data/kasalliklar-manba.txt` (ma’lumotnoma matni),
  `docker/prod-entrypoint.sh`. Demo seed, `src/`, testlar, `.env` yo‘q;
  npm/npx/corepack/yarn o‘chirilgan.
- Root emas: UID/GID `10001:10001`; fayllar root’ga tegishli va runtime
  foydalanuvchi uchun faqat o‘qish.
- `read_only: true`, `/tmp` — `tmpfs` (`noexec,nosuid,nodev`), `cap_drop: ALL`,
  `no-new-privileges`, `init: true`, `pids_limit`, CPU/memory limit,
  `stop_grace_period: 30s`.
- `HEALTHCHECK` → `/api/v1/health/live` (dependency tekshiruvisiz: DB uzilsa
  ham orkestrator hamma container’ni o‘ldirmaydi). To‘liq holat:
  `/api/v1/health` (DB, Redis, storage: faqat `up`/`down`).
- Graceful shutdown: SIGTERM → yangi so‘rovlarga 503, ishlayotganlari tugaydi,
  SMS worker to‘xtaydi, Prisma va Redis ulanishlari yopiladi.

## Deploydan oldingi tekshiruv

- [ ] CI yashil: typecheck, lint, format, unit, e2e, `npm audit`, gitleaks,
      semgrep, Trivy.
- [ ] Yangi migratsiyalar backward-compatible (eski API versiyasi bilan ishlaydi).
- [ ] So‘nggi oylik restore testi muvaffaqiyatli.
- [ ] `SWAGGER_ENABLED` o‘chiq, `CORS_ORIGINS` faqat https production domenlar,
      `TRUST_PROXY` aniq.
- [ ] `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` bo‘sh (IAM role), bucket Block
      Public Access yoqilgan.
