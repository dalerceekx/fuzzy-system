# riizq.uz — AWS Ubuntu + Docker

Bu paket bitta EC2 yoki Lightsail Ubuntu **24.04 LTS** serveri uchun:
React/Caddy → NestJS → PostgreSQL + Redis; fayllar private AWS S3’da.
Foydalanuvchi aytgan `24.02 LTS` versiyasini serverda `cat /etc/os-release`
bilan tekshiring. Buyruqlar 24.04 uchun yozilgan.

Faqat 80/443 portlar ochiladi. API, PostgreSQL va Redis host portlariga
chiqarilmaydi. Caddy TLS sertifikatini oladi va yangilaydi. Frontend API’ga
`/api/v1` orqali ulanadi; Secure cookie va CSRF bitta domenda ishlaydi.

Bu **bitta serverli** konfiguratsiya: server ishdan chiqsa sayt to‘xtaydi.
PostgreSQL/Redis persistent volume’larda; off-server backup alohida sozlanadi.
RDS/ElastiCache varianti kerak bo‘lsa, mavjud
[`compose.prod.yaml`](../../apps/backend/compose.prod.yaml) va
[operatsion hujjat](../../apps/backend/docs/operations/deployment.md) mavjud.

## Tayyorlangan holat

- Domen: `riizq.uz`.
- `.deploy/aws/` — lokal, Git va Docker context’dan chiqarilgan private fayllar.
  `api.env`, `migrate.env`, `postgres.env`, `redis.env` yangi, alohida kalit/parollar
  bilan yaratiladi; fayllar `0600`, katalog `0700`.
- Development `.env` o‘zgartirilmaydi. Undan faqat Eskiz email/parol/sender/shabloni
  explicit allowlist orqali ko‘chirilishi mumkin.
- S3 hali yaratilmagan: `api.env` ichida `S3_REGION`, `S3_BUCKET` to‘ldiriladi.
- Haqiqiy AWS deploy, Eskiz yuborish va public DNS/TLS tekshiruvi lokal testga
  kirmaydi. Eskiz kabinetida sender, shablon va balansni tekshirish kerak.

**Mavjud `.deploy/aws` ustiga generatorni qayta ishlatmang.** U ataylab rad
etadi: eski DB volume va shifrlangan ma’lumotlar eski parol/kalitlarni talab
qiladi. Keyingi release’da faqat image taglari yangilanadi. Barcha private
fayllarni parol menejerida yoki shifrlangan off-server nusxada saqlang.

## 1. Server, DNS, Docker

Boshlang‘ich konfiguratsiya uchun 2 vCPU / 4 GB RAM va kamida 30 GB diskdan
foydalaning; haqiqiy yuklamaga qarab o‘lchamni o‘zgartiring. Kichik serverda
image’larni alohida CI/mashinada build qilib, registry orqali olib keling.
Build mashinasi va server arxitekturasi bir xil bo‘lsin (`uname -m`), yoki
Buildx bilan kerakli platformani tanlang.

1. EC2 Elastic IP yoki Lightsail static IP biriktiring.
2. `riizq.uz` A yozuvini shu IP’ga yo‘naltiring. Ishlamaydigan AAAA yozuvini
   qoldirmang. Bu paket `www.riizq.uz` uchun alohida sayt sozlamaydi.
3. Security Group/Lightsail firewall: TCP 80/443 ochiq; SSH 22 faqat sizning
   IP’ingizdan. 3001, 5432, 6379, 9000 ochilmaydi.
4. Serverda Docker’ni rasmiy repository’dan o‘rnating:

```bash
sudo apt update
sudo apt install -y ca-certificates curl age
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# SSH'dan chiqib qayta kiring, keyin:
docker compose version
```

Compose **2.30+** kerak (`env_file.format: raw`). Ushbu format Eskiz parolidagi
`$`, `#`, qo‘shtirnoqlarni o‘zgartirmaydi. `api.env` da qiymatlarni tashqi
qo‘shtirnoq bilan o‘ramang; izohlarni alohida qatorga yozing. Serverda Node/npm
kerak emas: build ham, API ham Docker’da ishlaydi.

Frontend Dockerfile Caddy 2.11.7’ni Go 1.27.2 va `golang.org/x/net` 0.60.0
bilan qayta yig‘adi. Rasmiy tayyor image’dagi eski Go/HTTP2 komponentlariga
chiqqan xavfsizlik tuzatishlari shu orqali olinadi; `apps/frontend/caddy/go.mod`
va `go.sum` versiyalarni mahkamlaydi. Birinchi build Go modullarini yuklab,
kompilyatsiya qiladi va bir necha daqiqa ko‘proq davom etadi.
[Go release notes](https://go.dev/doc/devel/release#go1.27.2),
[Caddy source build](https://caddyserver.com/docs/build).

Manbalar: [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Compose raw env](https://docs.docker.com/reference/compose-file/services/#format),
[Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## 2. Private S3 va IAM

AWS CLI’ni [rasmiy yo‘riqnoma](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
bo‘yicha o‘rnating. Provisioning uchun AWS profilingiz bilan kiring.
Quyidagi buyruqlar **AWS resursi yaratadi**; tayyorlangan, avtomatik bajarilmagan.
Regionni server joylashgan AWS regioniga moslang. Bucket nomi global unique
bo‘lishi shart; misol nomdagi `ACCOUNT_ID` ni o‘z hisob ID’ingizga almashtiring.

```bash
bash deploy/aws/setup-s3.sh riizq-private-ACCOUNT_ID YOUR_AWS_REGION
```

Skript public access’ni bloklaydi, ACL’larni o‘chiradi, versioning va SSE-S3
shifrlashni yoqadi, HTTP’ni bucket policy orqali rad etadi. U yangi bucket
uchun: mavjud bucket policy’sini ko‘rmasdan qayta qo‘llamang.

[`s3-app-policy.json`](s3-app-policy.json) dagi `REPLACE_WITH_PRIVATE_BUCKET`
joylarini haqiqiy nomga almashtirib, ilova identifikatoriga biriktiring.
API ishga tushishda bucket privacy va health’ni tekshiradi, shu sababli faqat
`PutObject` ruxsatining o‘zi yetmaydi.

- **EC2:** IAM instance profile/role ishlating; `S3_ACCESS_KEY_ID` va
  `S3_SECRET_ACCESS_KEY` bo‘sh qoladi. IMDSv2 required va container uchun
  metadata response hop limit **2** sozlang. SDK role credential’larini oladi.
- **Lightsail:** EC2 instance profile’ni taxmin qilmang. Oddiy S3 bucket uchun
  faqat yuqoridagi policy’ga ega IAM foydalanuvchining access key/secret’ini
  serverdagi `api.env` ga kiriting. AWS root access key ishlatmang.

`api.env` ichida:

```dotenv
S3_REGION=YOUR_AWS_REGION
S3_BUCKET=riizq-private-ACCOUNT_ID
```

`S3_ENDPOINT` qo‘shmang: bu AWS, lokal MinIO emas. Bucket public bo‘lmasin.
Manbalar: [S3 policy actions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html),
[EC2 metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).

## 3. Fayllarni serverga ko‘chirish

Bu workspace’da `.deploy/aws` allaqachon tayyorlangan. Yangi o‘rnatish uchun
generatorni **faqat yangi katalogga** ishlating (Node 22+):

```bash
node deploy/aws/prepare.mjs --domain riizq.uz \
  --region YOUR_AWS_REGION --bucket riizq-private-ACCOUNT_ID \
  --eskiz-env apps/backend/.env --out .deploy/aws --tag 20261019-initial
```

Manba paketini yaratish:

```bash
npm run aws:package
```

Natija `.deploy/releases/` da `.tar.gz` va SHA-256 fayl. Paketda `.env*`, private
deploy config, `node_modules`, `dist`, backup va private kalitlar yo‘q.
Source paket va private konfiguratsiyani SSH orqali **alohida** yuboring:

```bash
ssh ubuntu@SERVER_IP 'mkdir -p ~/riizq; install -d -m 700 ~/.config/riizq'
scp .deploy/releases/riizq-source-RELEASE.tar.gz ubuntu@SERVER_IP:~/riizq/
scp .deploy/releases/riizq-source-RELEASE.tar.gz.sha256 ubuntu@SERVER_IP:~/riizq/
scp .deploy/aws/*.env ubuntu@SERVER_IP:~/.config/riizq/
ssh ubuntu@SERVER_IP
cd ~/riizq
sha256sum -c riizq-source-RELEASE.tar.gz.sha256
tar -xzf riizq-source-RELEASE.tar.gz
chmod 700 ~/.config/riizq
chmod 600 ~/.config/riizq/*.env
```

Private fayllarni public repo, Docker image yoki chatga joylamang. `compose.sh`
config katalogini absolute path’ga o‘zi aylantiradi: kompyuterdagi yo‘lni
serverga ko‘chirganda fayl ichini o‘zgartirish shart emas.

## 4. Build, preflight, release

Serverda loyiha ildizidan:

```bash
bash deploy/aws/compose.sh ~/.config/riizq build api web
bash deploy/aws/compose.sh ~/.config/riizq run --rm --no-deps api check-env
bash deploy/aws/release.sh ~/.config/riizq
```

`check-env` tarmoqqa chiqmaydi va SMS yubormaydi. Noto‘g‘ri runtime DB roli,
yetishmayotgan S3/Eskiz maydonlari, development secret, demo sozlama,
insecure cookie va domen/CORS nomuvofiqligi release’ni to‘xtatadi.

Release tartibi: preflight → PostgreSQL/Redis → schema-owner migratsiyalari →
kasalliklar ma’lumotnomasi → API dependency health → frontend/Caddy.
Schema owner URL faqat `migrate` konteynerida; API’da cheklangan
`meningfermam_app` roli. Demo seed bajarilmaydi.

Caddy uchun A/AAAA va 80/443 ochiq bo‘lishi shart; sertifikat ma’lumotlari
`caddy_data` volume’da saqlanadi. HTTPS tekshiruvi:

```bash
curl -I http://riizq.uz
curl -I https://riizq.uz/login
curl --fail https://riizq.uz/api/v1/health
bash deploy/aws/compose.sh ~/.config/riizq ps
```

Health javobida `database`, `redis`, `storage` uchalasi `up` bo‘lsin.
`/api/v1/health/live` faqat process liveness; AWS/S3 ulanishini isbotlamaydi.
Public URL’ni tashqi monitoringga ulang, disk/RAM va backup xatolari uchun
alert qo‘ying. Loglar avtomatik rotation qilinadi.

## 5. Birinchi admin va Eskiz

Demo loginlar production’da yo‘q. Birinchi haqiqiy administratorni yarating:

```bash
bash deploy/aws/compose.sh ~/.config/riizq run --rm --no-deps \
  -e BOOTSTRAP_PHONE=+998YOUR_PHONE \
  -e 'BOOTSTRAP_FULL_NAME=Ism Familiya' \
  api node dist/cli/create-super-admin.js
```

Parol yashirin stdin orqali so‘raladi, buyruq satriga qo‘shilmaydi. Birinchi
kirishda TOTP MFA sozlanadi. Bu komanda mavjud haqiqiy admin bo‘lsa rad etadi.

Eskiz kabinetida `4546` sender, aynan `SMS_OTP_TEMPLATE` matni va balansni
tekshiring. Keyin o‘zingiz boshqaradigan bitta telefon bilan register → OTP →
verify → login oqimini sinang. Bu qadam haqiqiy SMS yuboradi va haq yechishi
mumkin; lokal smoke uni bajarmaydi. Batafsil:
[Eskiz yo‘riqnomasi](../../apps/backend/docs/operations/eskiz-otp.md).

## 6. Shifrlangan backup va tiklash

Private age kalitini **o‘z kompyuteringizda** yarating va xavfsiz saqlang:

```bash
age-keygen -o riizq-backup-identity.key
age-keygen -y riizq-backup-identity.key > backup-recipients.txt
```

Serverga faqat `backup-recipients.txt` public kaliti yuboriladi. `backup.sh`
`meningfermam_backup` read-only roli orqali dump qiladi; plaintext dump diskka
yozilmaydi. `pg_dump` yoki encryption xatosida muvaffaqiyat deb qaytmaydi.

```bash
bash deploy/aws/backup.sh ~/.config/riizq ~/.config/riizq/backup-recipients.txt \
  ~/riizq-backups s3://YOUR_BACKUP_BUCKET/postgres
```

Backup uchun alohida private/versioned bucket yarating. Backup identifikatoriga
faqat o‘sha prefix’da `s3:PutObject`, `s3:AbortMultipartUpload` bering; kundalik
upload uchun delete ruxsati kerak emas. AWS CLI serverdagi credential/role’ni
ishlatadi. API `.env` credential’lari host CLI’ga avtomatik o‘tmaydi.

Cron misoli (yo‘llarni o‘z serveringizga moslang):

```cron
15 2 * * * /bin/bash /home/ubuntu/riizq/deploy/aws/backup.sh /home/ubuntu/.config/riizq /home/ubuntu/.config/riizq/backup-recipients.txt /home/ubuntu/riizq-backups s3://YOUR_BACKUP_BUCKET/postgres >> /home/ubuntu/riizq-backup.log 2>&1
```

Mahalliy nusxalar avtomatik o‘chirilmaydi; disk monitoringi va backup bucket
lifecycle retention’ini sozlang. Backup muvaffaqiyatsiz bo‘lsa alert kerak.
`.config/riizq/api.env`, ayniqsa `DATA_ENCRYPTION_KEY` ni ham alohida shifrlangan
backup’da saqlang: bazaning o‘zi MFA/shifrlangan SMS’ni tiklashga yetmaydi.

Har oy alohida bo‘sh server/stack’da restore sinovi qiling. **Ishlayotgan
production DB’da quyidagi restore’ni bajarmang.** Yangi stack’da PostgreSQL
init rollarni yaratsin, API/migratsiyalar hali ishga tushmagan bo‘lsin:

```bash
set -o pipefail
# Dump va .sha256 fayli bir katalogda:
sha256sum -c BACKUP.dump.age.sha256
bash deploy/aws/compose.sh ~/.config/riizq up -d --wait postgres
age --decrypt -i /SAFE_PATH/riizq-backup-identity.key BACKUP.dump.age | \
  bash deploy/aws/compose.sh ~/.config/riizq exec -T postgres \
  pg_restore -U postgres -d meningfermam --role=meningfermam_owner \
  --no-owner --exit-on-error --single-transaction
```

Kalitni serverda doimiy saqlamang; decrypt oqimini operator mashinasidan SSH
orqali uzatish ham mumkin. So‘ng mos eski `api.env` encryption key bilan
release va health tekshiruvini bajaring. ACL/grant’lar dump’dan tiklanadi.

## 7. Yangilash va rollback

1. Backup muvaffaqiyatini tekshiring, oldingi image taglarini yozib oling.
2. Manbani yangilang; `compose.env` ichida yangi unique `API_IMAGE` va
   `WEB_IMAGE` taglari kiriting. Private kalitlarni qayta yaratmang.
3. `build api web`, `check-env`, `release.sh` va public HTTPS testlarni bajaring.
4. Ilova rollback’i: `compose.env` ga oldingi taglarni qaytarib,
   `compose.sh ... up -d --wait api web`. Bu DB migratsiyasini qaytarmaydi;
   schema eski kodga mos bo‘lmasa forward fix yoki rejalangan restore kerak.

`docker compose down -v` production’da ishlatilmaydi: data va TLS volume’lari
o‘chadi. Hamma konteynerni ommaviy prune qilish ham deploy bosqichi emas.

## Tekshiruvlar

```bash
npm run test:deploy
docker build -f apps/backend/Dockerfile -t riizq-api:aws-prep .
docker build -f apps/frontend/Dockerfile -t riizq-web:aws-prep .
npm run test:deploy:smoke
```

Smoke noyob Compose project va vaqtinchalik volume’lar ishlatadi; faqat
o‘z resurslarini o‘chiradi. Production rejimidagi API, haqiqiy Postgres/Redis,
lokal MinIO va Caddy internal CA bilan tekshiriladi. AWS IAM, public ACME,
haqiqiy Eskiz delivery va yuklama testining o‘rnini bosmaydi.
