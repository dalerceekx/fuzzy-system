RIIZQ Eskiz OTP — 2026-10-19 tekshiruv hisoboti

Mavjud integratsiya tekshirildi va kamchiliklari tuzatildi. NestJS auth,
JWT/sessiyalar, scrypt, rollar, guard’lar, Prisma modellari va migratsiyalar,
Redis, ConfigModule/Zod, Docker Compose, SMS navbati, frontend OTP formalari
hamda npm/Vitest testlari ko‘rib chiqildi. `User.phoneVerifiedAt` mavjudligi
sabab yangi migratsiya kerak bo‘lmadi. Mavjud `.env` va production ma’lumotlari
o‘zgartirilmadi; haqiqiy SMS yuborilmadi.

[Rasmiy Eskiz hujjati](https://documenter.getpostman.com/view/663428/TVK5eMco)
va uning Postman collection’i orqali login, PATCH refresh, Bearer, multipart
SMS maydonlari hamda `id`/`waiting` javobi tekshirildi.

| Holat | Natija |
| --- | --- |
| COMPLETE | Olti xonali tasodifiy OTP, HMAC, Redis TTL, atomar bir martalik tekshiruv, urinishlar chegarasi, telefon/IP limitlari, resend va ro‘yxatdan o‘tish oqimi avtomatik testlardan o‘tdi. |
| COMPLETE | SMS navbati asl OTP muddatini saqlaydi. Navbat, login yoki token yangilashdagi kechikish eskirgan kodni yuborishga olib kelmaydi. |
| COMPLETE | Yangi ro‘yxatdan o‘tish kodi tasodifan oldingi kod bilan teng bo‘lsa, backend qaytadan kod yaratadi. |
| COMPLETE | Eskiz HTTP transporti mock qilingan holda haqiqiy DI → provayder → Redis navbati → PostgreSQL → OTP → JWT login integratsiyasi tekshirildi. |
| BLOCKED | Backend `.env` da `ESKIZ_EMAIL` va `ESKIZ_PASSWORD` yo‘q. Akkauntdagi `4546` sender ruxsati va shablon tasdig‘i tekshirilmagan. |
| NOT TESTED | Haqiqiy SMS yetkazilishi, Eskiz kabinetidagi yakuniy holat va production/Lightsail muhiti. |

O‘zgartirilgan fayllar (`apps/backend` ga nisbatan):

- `src/auth/otp.service.ts`: avvalgi kodni takrorlamaslik va OTP tugash muddatini SMS qatlamiga uzatish.
- `src/sms/sms.service.ts`, `sms.types.ts`, `sms.queue.ts`, `sms.worker.ts`: asl muddat, Redis `PXAT`, yuborish va retry oldidagi tekshiruvlar.
- `src/sms/providers/eskiz-sms.provider.ts`: autentifikatsiyadan oldin/keyin OTP muddatini tekshirish; token cache chegarasini mahalliy siyosat sifatida aniq izohlash.
- `src/sms/providers/eskiz-sms.provider.spec.ts`, `src/sms/sms.worker.spec.ts`: muddati o‘tgan kod, login/refresh kechikishi, retry chegarasi va boshqariladigan test soati.
- `test/auth/otp-redis.e2e-spec.ts`, `test/sms/sms-queue.e2e-spec.ts`: kod tasodifan takrorlanishi va navbat TTL’i uchun regressiya testlari.
- `test/platform/sms-stub.e2e-spec.ts`, `test/sms/sms-service.e2e-spec.ts`, `test/security/logs-no-secrets.e2e-spec.ts`: RIIZQ shabloni, qabul qilingan SMS logi va telefon bo‘yicha umumiy cooldown’ga mos kutishlar.
- Yangi `test/sms/eskiz-registration.e2e-spec.ts`: Eskiz bilan to‘liq oqim, maxfiy loglar, autentifikatsiya xatosi va noaniq timeout.
- `docs/operations/eskiz-otp.md` va ushbu yangi hisobot.

Frontend’da `src/features/auth/components/VerifyPhoneForm.tsx` va
`PasswordRecoveryForms.tsx` dagi lint xatolari tuzatildi; muddat holati mavjud
OTP hook’idan olinadi, backend muddatni mustaqil tekshiradi. `vite.config.ts`
test worker’larini ikkita bilan cheklaydi: odatdagi `npm test` Docker dev
stack ishlayotgan kompyuterda ham o‘tadi.

Amalda bajarilgan yakuniy tekshiruvlar:

| Buyruq | Natija |
| --- | --- |
| `npm test` | COMPLETE — backend: 53 fayl / 924 test; frontend: 16 fayl / 170 test. |
| `npm run test:e2e -w apps/backend` | COMPLETE — 70 fayl / 1121 test. Alohida vaqtinchalik PostgreSQL 16 va Redis 7 konteynerlari ishlatildi va yakunda to‘xtatildi. |
| Har ikki workspace uchun `npm run typecheck` | COMPLETE |
| `npm run lint` | COMPLETE |
| `npm run format:check -w apps/backend` | COMPLETE |
| `npm run build` | COMPLETE — backend va frontend. |
| `npm run verify:bundle -w apps/frontend` | COMPLETE — development kodlari/demo belgilariga qarshi 13 tekshiruv. |
| `npm run audit:deps` | COMPLETE — 0 vulnerabilities. |

Dastlab FAILED bo‘lgan SMS testlarida eski shablon/log matni, noaniq xatoda
uch marta retry kutish va cooldown tugamasdan yangi oqimni boshlash bor edi.
Kutishlar talabga moslandi. Bir unit testdagi 1 ms vaqtga bog‘liqlik boshqariladigan
soat bilan tuzatildi. Yakuniy testlarda xato qolmadi. E2e jarayonida mavjud
dinamik import va test HTTP server listener’lari haqida warning’lar chiqadi;
S3 xato holatini tekshiruvchi testlar ham diagnostika chiqaradi. Haqiqiy S3
yoki SMS yetkazilishi bu natijalardan kelib chiqib tasdiqlanmaydi.

Dastlab backend build Docker yaratgan `dist` ichidagi root egali fayllarda
`EACCES` bilan to‘xtadi. Faqat shu lokal build papkasining egaligi joriy
foydalanuvchiga qaytarildi; takroriy `npm run build` exit code 0 bilan o‘tdi.

Mahalliy sinov:

1. Backend muhiti: `NODE_ENV=development`, `SMS_PROVIDER=mock`, `SMS_ENABLED=true`.
2. Repo ildizida `npm run start:dev:all`; ro‘yxatdan o‘tish formasida ism, telefon va parol kiriting.
3. Kodni `http://localhost:3001/api/v1/dev/sms-inbox` dan oling va kiriting; tasdiqdan keyin odatdagi login ishlaydi.
4. Qayta yuborish 60 soniyadan so‘ng ochiladi. Kod 300 soniyada tugaydi, beshta noto‘g‘ri urinishdan keyin ishlamaydi; qayta ishlatish rad etiladi.

API: `POST /api/v1/auth/otp/send` uchun `{phone, fullName, password}`;
`POST /api/v1/auth/otp/verify` uchun `{verificationId, code}`;
`POST /api/v1/auth/otp/resend` uchun `{verificationId}`. Eski `/auth/register`
va `/auth/verify-phone` endpoint’lari ham saqlangan.

Haqiqiy Eskiz uchun zarur sozlamalar:

```dotenv
SMS_PROVIDER=eskiz
SMS_ENABLED=true
SMS_MOCK_MODE=false
ESKIZ_EMAIL=<akkaunt emaili>
ESKIZ_PASSWORD=<akkaunt paroli>
ESKIZ_BASE_URL=https://notify.eskiz.uz/api
ESKIZ_FROM=4546
OTP_LENGTH=6
OTP_EXPIRES_IN=300
OTP_RESEND_COOLDOWN=60
OTP_MAX_ATTEMPTS=5
OTP_MAX_REQUESTS_PER_HOUR=5
OTP_HMAC_SECRET=<kamida 32 belgili mustaqil tasodifiy kalit>
SMS_OTP_TEMPLATE="RIIZQ: Tasdiqlash kodingiz: {code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang."
```

Mavjud `OTP_PEPPER` saqlansa, `OTP_HMAC_SECRET` bilan teng bo‘lishi shart;
TTL/cooldown eski va yangi nomlari ham bir xil bo‘lsin. Amaldagi JWT, DB,
Redis va shifrlash sozlamalari zarur bo‘lib qoladi. Sirlarni frontend’ga bermang.
Production mock yoki yetishmayotgan credential bilan ishga tushmaydi.

Eskiz kabinetida akkaunt/API faolligi, balans, aynan `4546` uchun ruxsat,
SMS shablonining to‘liq mosligi va qabul qiluvchi cheklovlarini tekshiring.
`RIIZQ.uz` kampaniya nomi sender tasdig‘ini bildirmaydi. Shablon farq qilsa
`SMS_OTP_TEMPLATE` ni tasdiqlangan matnga moslang. Keyin alohida ruxsat bilan
nazorat raqamiga SMS yuborib, telefonga kelishi, kod tekshiruvi va loginni
tekshirish kerak. `202`, Eskiz `waiting` yoki mahalliy `SENT` faqat qabul
qilinganlikni bildiradi; Eskiz delivery callback’i ulanmagan.

Production holati: mahalliy avtomatik tekshiruvlar COMPLETE. Akkaunt ruxsati,
shablon va haqiqiy SMS sinovi yakunlanmaguncha to‘liq production-ready deb
belgilanmaydi. Production migratsiyasi, secret o‘zgarishi yoki deploy bajarilmadi.
