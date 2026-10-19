# Eskiz SMS OTP

Mavjud NestJS auth, Redis, PostgreSQL/Prisma va SMS navbati ishlatiladi. JWT,
scrypt parol xeshi, rollar va sessiyalar oqimi saqlanadi. `users.phoneVerifiedAt`
allaqachon mavjud: bu integratsiya uchun DB migratsiyasi kerak emas.

Bajarilgan o‘zgarishlar, test natijalari va tashqi cheklovlar:
[2026-10-19 tekshiruv hisoboti](eskiz-otp-validation.md).

## Arxitektura va cheklovlar

- Kriptografik tasodifiy 6 xonali kod, standart amal muddati 300 soniya.
  Yangi ro‘yxatdan o‘tish yoki resend tasodifan oldingi kodni qaytarsa,
  backend boshqa kod hosil qiladi; oldingi kodning ochiq matni kerak emas.
- Redis’da TTL bilan faqat HMAC tekshiruvchi qiymat va urinishlar soni turadi.
  PostgreSQL OTP yozuvi foydalanuvchi, telefon, maqsad, avlod xeshi va yakuniy
  ishlatilgan holatni tranzaksiyada bog‘laydi. Ochiq kod DB’da saqlanmaydi.
- To‘g‘ri kod Redis’da atomar o‘chiriladi. Account faollashishi va OTP sarflanishi
  bitta DB tranzaksiyasida bo‘ladi; shu sabab parallel tekshiruvdan bittasi o‘tadi.
  Resend oralig‘ida eski tekshiruv natijasi yangi kodni sarflay olmaydi.
- 5 ta noto‘g‘ri urinishdan keyin kod rad etiladi. Resend yangi kod va urinishlar
  hisobini yaratadi. Barcha SMS chiqaruvchi yo‘llar telefon uchun 60 soniya kutish,
  telefon va IP uchun soatiga 5 ta so‘rov limitini birgalikda qo‘llaydi.
  Avvalgi endpoint va kunlik SMS limitlari ham amal qiladi.
- Redis ishlamasa tasdiqlash yopiq qoladi. Redis’da kod sarflangandan keyin DB
  tranzaksiyasi bajarilmasa foydalanuvchi qayta kod so‘rashi kerak.
- Ro‘yxatdan o‘tish javobi bir xil `202`: mavjud aktiv raqam haqida ma’lumot
  oshkor qilinmaydi. Account faqat kod muvaffaqiyatli tasdiqlanganda aktivlashadi.
- Eskiz tokeni faqat backend xotirasida saqlanadi; parallel autentifikatsiya
  so‘rovlari birlashtiriladi. Token muddati tugaganda yangilanadi. Restart’dan
  keyin keyingi yuborishda qayta autentifikatsiya bo‘ladi.
- SMS navbatining vaqtinchalik matni mavjud AES-256-GCM yordamida shifrlanadi;
  yuborilgandan yoki muddati tugagandan keyin navbatdan olib tashlanadi.
  OTP, token va parollar loglarga yozilmaydi; telefon niqoblanadi.
  Navbat TTL’i OTP yaratilgan paytdagi yakuniy muddat bilan chegaralanadi.
  Navbatdagi kechikish, Eskiz login yoki token yangilash kod muddatini uzaytirmaydi.
- Tarmoq timeout’i 10 soniya. SMS timeout’i yoki noaniq javobda avtomatik qayta
  yuborish yo‘q: Eskiz birinchi so‘rovni qabul qilgan bo‘lishi mumkin. Aniq
  `401` bo‘lsa token yangilanib, yuborish faqat bir marta takrorlanadi.

Yangi Redis verifier talabi eski, hali amal qilayotgan DB-only OTP kodlarini
tasdiqlamaydi. Yangilashdan keyin foydalanuvchi resend qilishi kerak. Turli kod
versiyalarini bir vaqtda uzoq ishlatmasdan yangilashni yakunlang. HMAC kaliti
almashtirilsa ham oldingi kodlar yaroqsiz bo‘ladi.

## Eskiz API shartnomasi

Manba: [Eskiz rasmiy Postman hujjati](https://documenter.getpostman.com/view/663428/TVK5eMco).
API maydonlari va javob namunalari 2026-10-19 kuni rasmiy Postman collection
orqali qayta tekshirildi. Akkauntga kirish va haqiqiy SMS yuborish bajarilmadi.

| Amal | So‘rov | Kutiladigan javob |
| --- | --- | --- |
| Kirish | `POST /api/auth/login`, multipart `email`, `password` | `data.token` |
| Token yangilash | `PATCH /api/auth/refresh`, `Authorization: Bearer …` | `data.token` |
| SMS yuborish | `POST /api/message/sms/send`, Bearer; multipart `mobile_phone`, `message`, `from` | `id`, `status: "waiting"` |

Telefon Eskiz’ga `998901234567` ko‘rinishida, `+` belgisiz yuboriladi. Ilova API’si
esa `+998901234567` ko‘rinishini qabul qiladi va normalizatsiya qiladi.

`waiting` — provayder so‘rovni qabul qildi. Mahalliy `SmsMessage.status=SENT`
ham shuni bildiradi; bu telefonga yetkazilganini tasdiqlamaydi. Eskiz uchun
yetkazish callback’i ulanmagan: mavjud HTTP provayderining HMAC webhook’i
Eskiz callback’i bilan avtomatik mos deb olinmaydi. Yetkazilish holatini Eskiz
kabinetida tekshiring.

## Muhit sozlamalari

Development uchun `.env.example` dagi `SMS_PROVIDER=mock` yetarli. Haqiqiy
eskiz akkaunti bilan ishlash uchun backend muhiti:

```dotenv
SMS_PROVIDER=eskiz
SMS_ENABLED=true
SMS_MOCK_MODE=false
ESKIZ_EMAIL=<akkaunt emaili>
ESKIZ_PASSWORD=<akkaunt paroli>
ESKIZ_BASE_URL=https://notify.eskiz.uz/api
ESKIZ_FROM=4546
OTP_HMAC_SECRET=<kamida 32 belgili mustaqil tasodifiy kalit>
OTP_LENGTH=6
OTP_EXPIRES_IN=300
OTP_RESEND_COOLDOWN=60
OTP_MAX_ATTEMPTS=5
OTP_MAX_REQUESTS_PER_HOUR=5
SMS_OTP_TEMPLATE="RIIZQ: Tasdiqlash kodingiz: {code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang."
```

Yangi kalitni `openssl rand -base64 48` bilan yarating va secret manager’da
saqlang. Mavjud `OTP_PEPPER` ni o‘zboshimchalik bilan almashtirmang:
`OTP_HMAC_SECRET` uning yangi nomi. Ikkalasi berilsa qiymatlar teng bo‘lishi
shart. Xuddi shu qoida `OTP_EXPIRES_IN` / `OTP_TTL_SECONDS` va
`OTP_RESEND_COOLDOWN` / `OTP_RESEND_COOLDOWN_SECONDS` juftliklariga tegishli.
Avvalgi environment nomlari ishlashda davom etadi.

`OTP_MAX_SENDS=5` bitta verification ID uchun jami yuborishlar chegarasi.
`SMS_DAILY_LIMIT_PER_PHONE=10` va `SMS_DAILY_LIMIT_PER_IP=50` kunlik qo‘shimcha
chegaralar; kun Toshkent vaqtida hisoblanadi. TTL o‘zgarsa SMS shablonidagi
amal muddati matnini ham Eskiz’da tasdiqlatilgan mos matnga o‘zgartiring.

`SMS_MOCK_MODE=true` development/test’da Eskiz sozlamalari bilan mock ishlatish
imkonini beradi. `SMS_ENABLED=false` tashqi SMS so‘rovini o‘chiradi. Production
mock, o‘chirilgan SMS yoki yetishmayotgan Eskiz credential’lari bilan ishga
tushmaydi. Avtomatik mock fallback yo‘q. Credential’lar frontend `VITE_*`
o‘zgaruvchilariga berilmaydi.

## API va mahalliy sinov

1. Backend `.env` da `NODE_ENV=development`, `SMS_PROVIDER=mock`,
   `SMS_ENABLED=true`, `SMS_MOCK_MODE=false` ekanini tekshiring. Mavjud
   `.env` ni qayta nusxalab secret’larni bosib yozmang.
2. Repo root’dan `npm run start:dev:all` bajaring. Frontend ro‘yxatdan o‘tish
   sahifasida ism, telefon va parol kiriting.
3. `http://localhost:3001/api/v1/dev/sms-inbox` manzilidagi oxirgi mock SMS’dan
   kodni oling. Bu endpoint faqat development mock rejimida mavjud.
4. Kodni kiriting; tasdiqdan keyin mavjud login oqimidan foydalaning. Eski kodni
   qayta yuborish rad etiladi. Qayta yuborish tugmasi 60 soniyadan keyin ochiladi.

API orqali ham xuddi shu oqim ishlaydi. Quyidagi so‘rovlarni **faqat mock
rejimida** bajaring; haqiqiy rejimda ular pullik SMS yuborishi mumkin.

```http
POST /api/v1/auth/otp/send
Content-Type: application/json

{"phone":"+998901234567","fullName":"Ali Valiyev","password":"Mustahkam-parol-2026"}
```

`/otp/send` mavjud `/auth/register` uchun alias: telefonning o‘zi yetarli emas,
ism va parol ham talab qilinadi. Javob:

```json
{"verificationId":"<uuid>","expiresIn":300,"resendAfter":60,"message":"Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi"}
```

```http
POST /api/v1/auth/otp/verify
Content-Type: application/json

{"verificationId":"<yuqoridagi uuid>","code":"<SMS’dagi 6 xonali kod>"}
```

Muvaffaqiyatli javob `200` bo‘ladi. `/auth/verify-phone` eski manzili ham ishlaydi.
Kod xato, eskirgan yoki sarflangan bo‘lsa `400 OTP_INVALID`; limitda `429
RATE_LIMITED` va `Retry-After`; Redis tekshiruvchi xizmati ishlamasa `503
OTP_UNAVAILABLE` qaytadi. Yuborishdagi `202` SMS telefonga yetganini anglatmaydi.

```http
POST /api/v1/auth/otp/resend
Content-Type: application/json

{"verificationId":"<yuqoridagi uuid>"}
```

## Avtomatlashtirilgan tekshiruv

Unit testlarda tashqi HTTP transporti mock; e2e testlarda SMS provayderi mock.
Test sozlamalari tashqi `ESKIZ_*`, `SMS_*` va boshqa app o‘zgaruvchilarini
tozalab, xavfsiz test qiymatlarini o‘rnatadi.

```sh
npm run typecheck -w apps/backend
npm run lint
npm test
npm run build
```

Frontend testlari Docker dev stack bilan birga barqaror ishlashi uchun
`vite.config.ts` da ikkita parallel worker bilan cheklangan.

`test/sms/eskiz-registration.e2e-spec.ts` haqiqiy NestJS DI, Eskiz provayderi,
Redis navbati va PostgreSQL bilan ro‘yxatdan o‘tish → tasdiqlash → JWT login
oqimini tekshiradi. Faqat tashqi HTTP transporti mock qilinadi: testlar hech
qachon haqiqiy SMS yubormaydi. Eskiz autentifikatsiya xatosi va noaniq timeout’da
akkaunt tasdiqlanmasligi ham tekshiriladi.

E2e uchun alohida bo‘sh PostgreSQL test bazasi va alohida Redis instance
ajrating. `TEST_DATABASE_URL` nomi `<name>_test[_<suffix>]`, `TEST_REDIS_URL`
esa nol bo‘lmagan Redis DB raqamiga olib borishi kerak. Mavjud global setup
test Redis DB’ni tozalaydi va test DB’ga migratsiyalarni qo‘llaydi; uni amaldagi
ma’lumotlar saqlanayotgan manzilga yo‘naltirmang. `TEST_DB_RESET=true` kerak emas.

```sh
TEST_DATABASE_URL='<faqat alohida test bazasi URL>' \
TEST_REDIS_URL='redis://127.0.0.1:<alohida test porti>/1' \
npm run test:e2e -w apps/backend -- test/auth test/security/otp-replay.e2e-spec.ts test/sms
```

## Haqiqiy SMS’ni yoqishdan oldin

Eskiz kabinetida quyidagilar qo‘lda tekshiriladi:

1. Akkaunt va API kirishi faol; balans hamda SMS yuborish imkoniyati mavjud.
2. `4546` aynan shu akkaunt uchun ruxsat etilgan sender. `RIIZQ.uz` kampaniya
   nomi bo‘lishi uning sender sifatida tasdiqlanganini anglatmaydi.
3. Yuqoridagi SMS matni tasdiqlangan shablonga to‘liq mos. Farq bo‘lsa
   `SMS_OTP_TEMPLATE` ni tasdiqlangan matnga moslang; `{code}` backend’da almashadi.
4. Test rejimi yoki akkauntga xos qabul qiluvchi cheklovlari aniqlangan.
5. Foydalanuvchi ruxsat bergan nazorat raqamiga bitta haqiqiy SMS yuborib,
   kabinetdagi yakuniy holat, telefonga kelishi, OTP tekshiruvi va login tekshirilgan.

Haqiqiy SMS sinovi, production secret’larini o‘zgartirish va production deploy
alohida ruxsat bilan bajariladi. Kod tekshiruvlari o‘tishi akkauntdagi sender,
shablon yoki haqiqiy yetkazishni tasdiqlamaydi. Ushbu tashqi tekshiruvlar
bajarilmaguncha Eskiz ulanishi production’da tasdiqlangan deb belgilanmaydi.
