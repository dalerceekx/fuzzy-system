# Backup va restore

Ikki mustaqil qatlam: (1) RDS avtomatik backup + PITR, (2) shifrlangan
mantiqiy `pg_dump` alohida, qulflangan bucket’da. Har oy restore testi
o‘tkaziladi — tekshirilmagan backup backup hisoblanmaydi.

## Maqsadlar

| Ko‘rsatkich | Maqsad | Qanday |
| --- | --- | --- |
| RPO (yo‘qotish mumkin bo‘lgan ma’lumot) | ≤ 5 daqiqa | RDS PITR (WAL arxivi) |
| RPO, region/akkaunt yo‘qolsa | ≤ 24 soat | kunlik `pg_dump` boshqa akkaunt bucket’ida |
| RTO (tiklash vaqti) | ≤ 2 soat | oylik restore testida o‘lchanadi |

## 1. RDS avtomatik backup va PITR

- `BackupRetentionPeriod`: 14–35 kun; storage encryption **KMS customer managed
  key** bilan (`StorageEncrypted=true`, `KmsKeyId=…`).
- `DeletionProtection=true`, o‘chirishda yakuniy snapshot majburiy.
- Snapshot’lar AWS Backup orqali boshqa regionga nusxalanadi (o‘sha KMS’ning
  multi-region kaliti bilan).
- PITR bilan tiklash yangi instance yaratadi (eski instance’ga tegmaydi):

  ```sh
  aws rds restore-db-instance-to-point-in-time \
    --source-db-instance-identifier meningfermam-prod \
    --target-db-instance-identifier meningfermam-pitr-YYYYMMDD \
    --restore-time 2026-10-16T09:55:00Z \
    --db-subnet-group-name meningfermam-private \
    --vpc-security-group-ids sg-db-private
  ```

## 2. Mantiqiy backup (`scripts/db/backup.sh`)

Har kecha (masalan, ECS scheduled task / cron, 02:30 Toshkent):

```sh
PGHOST=<rds-endpoint> PGPORT=5432 PGUSER=meningfermam_backup \
PGDATABASE=meningfermam PGSSLMODE=verify-full PGSSLROOTCERT=/etc/ssl/rds-ca.pem \
PGPASSFILE=/etc/meningfermam/backup.pgpass \
AGE_RECIPIENTS_FILE=/etc/meningfermam/backup-recipients.txt \
BACKUP_S3_URI=s3://<backup-bucket>/postgres \
  scripts/db/backup.sh
```

Skript nima qiladi:

1. `pg_dump -Fc` (faqat o‘qish huquqli `meningfermam_backup` rol bilan);
2. oqimni diskka yozishdan oldin **`age`** bilan public kalit(lar)ga shifrlaydi
   (`backup-recipients.txt` da faqat public kalitlar; private kalit bu
   serverda yo‘q);
3. `.sha256` checksum yozadi;
4. bucket’ga `--sse aws:kms` bilan yuklaydi;
5. lokal nusxalarni 3 kundan keyin o‘chiradi.

Parol argv’da emas (`ps` da ko‘rinmaydi): libpq `PGPASSFILE` (yoki IAM auth).

### Backup bucket talablari

- Alohida AWS akkaunt (yoki kamida alohida bucket) — production IAM rollari
  u yerdan o‘qiy/o‘chira olmaydi;
- Block Public Access: hammasi yoqilgan; bucket policy `aws:SecureTransport`
  ni talab qiladi;
- Versioning + **S3 Object Lock** (compliance mode, 35 kun);
- SSE-KMS (alohida kalit), lifecycle: 35 kundan keyin Glacier, 1 yildan keyin
  o‘chirish;
- backup task’ining IAM roli: faqat `s3:PutObject` (o‘qish/o‘chirish yo‘q);
- restore test roli: faqat `s3:GetObject`, `s3:ListBucket`.

### Kalitlarni boshqarish

```sh
age-keygen -o backup-identity.txt        # private kalit — oflayn/secret manager
age-keygen -y backup-identity.txt >> backup-recipients.txt   # public kalit
```

Private kalit ikki nusxada (secret manager + oflayn seyf) saqlanadi va kamida
ikki kishi kirisha oladi. GPG ishlatilsa: `gpg --encrypt --recipient …`
(skriptdagi `age` qatorini almashtiring).

## 3. Restore (haqiqiy hodisa)

1. Hodisani qayd eting, yozuvlarni to‘xtating (API’ni `0` replica yoki
   maintenance sahifa).
2. Avval PITR (1-bo‘lim) — eng kichik RPO. U mumkin bo‘lmasa, mantiqiy backup:

   ```sh
   aws s3 cp s3://<backup-bucket>/postgres/<fayl>.dump.age .
   aws s3 cp s3://<backup-bucket>/postgres/<fayl>.dump.age.sha256 .
   sha256sum -c <fayl>.dump.age.sha256
   age --decrypt --identity backup-identity.txt --output restore.dump <fayl>.dump.age
   # yangi, bo‘sh baza; rollar database.md bo‘yicha oldindan yaratilgan
   pg_restore --dbname=meningfermam --role=meningfermam_owner --exit-on-error --jobs=4 restore.dump
   shred -u restore.dump
   ```

3. `scripts/db/restore-test.sh` dagi tekshiruvlarni yangi bazada bajaring
   (yoki skriptni `RESTORE_DB` bilan ishga tushiring), so‘ng
   `prisma migrate deploy` (yangi migratsiyalar bo‘lsa).
4. `DATABASE_URL` ni yangi instance’ga almashtiring, API’ni yoqing, health va
   asosiy oqimlarni tekshiring.
5. Barcha sessiyalarni bekor qilish kerakmi — hodisa turiga qarab hal qiling
   (`JWT_REFRESH_SECRET` rotatsiyasi: `secrets.md`).

## 4. Oylik restore testi (`scripts/db/restore-test.sh`)

Har oyning birinchi dushanbasi (avtomatik scheduled task + natija kanalga):

```sh
PGHOST=<scratch-server> PGUSER=restore_tester PGSSLMODE=verify-full \
PGPASSFILE=/etc/meningfermam/restore.pgpass \
AGE_IDENTITY_FILE=/secure/backup-identity.txt \
BACKUP_S3_URI=s3://<backup-bucket>/postgres \
  scripts/db/restore-test.sh
```

Skript:

1. eng so‘nggi `*.dump.age` ni yuklab, checksum’ni tekshiradi;
2. scratch serverda `meningfermam_restore_test` bazasini yaratadi (nomida
   `restore` bo‘lmasa ishlamaydi — production’ni tasodifan o‘chirmaslik uchun);
3. deshifrlab `pg_restore --no-owner --no-acl --exit-on-error` qiladi;
4. tekshiradi: barcha migratsiyalar qo‘llangan; faol (demo bo‘lmagan)
   `SUPER_ADMIN` bor; ombor qoldig‘i manfiy emas va oxirgi harakat balansiga
   teng; append-only trigger’lar va CHECK constraint’lar joyida; oxirgi audit
   yozuvi 26 soatdan yosh (backup yangiligi);
5. bazani o‘chiradi (`KEEP_DB=true` bo‘lsa qoldiradi) va umumiy vaqtni chiqaradi
   — RTO jurnaliga yozing.

Non-zero exit = backup ishonchsiz → hodisa sifatida ko‘ring.

Scratch server production tarmog‘idan ajratilgan bo‘lsin; tiklangan ma’lumot
shaxsiy ma’lumot hisoblanadi — test tugashi bilan o‘chiriladi.
