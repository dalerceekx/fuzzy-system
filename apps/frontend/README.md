# Mening Fermam — frontend

Fermerlar va administratorlar uchun veb-ilova: React 19 + TypeScript (strict) + Vite 8 + Tailwind CSS 4,
React Router 8, TanStack Query 5, Axios, Zustand, React Hook Form + Zod, Lucide, Recharts.
Backend: `apps/backend` (NestJS). Barcha matnlar o‘zbek tilida (lotin).

## Ishga tushirish

Monorepo ildizidan (npm workspaces; faqat npm — `apps/frontend` ichida alohida `pnpm install`/`npm install`
qilinmaydi, bitta root `package-lock.json`):

```bash
npm ci                      # root’da, ikkala workspace uchun
cp apps/frontend/.env.example apps/frontend/.env.development.local
npm run start:dev:all       # backend (Docker, fonda) tayyor bo‘lgach → frontend http://localhost:5173
```

Backend allaqachon ishlayotgan bo‘lsa: `npm run dev:web` (yoki `apps/frontend` ichidan `npm run dev`).

| Manzil | |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3001/api/v1 |
| Swagger | http://localhost:3001/docs |

Backend `.env`ida `CORS_ORIGINS=http://localhost:5173` bo‘lishi kerak (dev’da bor).

### Muhit o‘zgaruvchilari

`.env.example` → `.env.development.local` ga nusxa oling (`.env` ga emas: `.env` production build’da ham
o‘qiladi va undagi demo qiymatlar `vite build` ni to‘xtatadi). `VITE_` bilan boshlanuvchi har bir qiymat
brauzer bundle’iga kiradi — **backend secret’lari (JWT, DB, S3, SMS kalitlari) bu yerga hech qachon yozilmaydi.**

| O‘zgaruvchi | Izoh |
| --- | --- |
| `VITE_API_BASE_URL` | Default `http://localhost:3001/api/v1`. Production’da `/api/v1` (pastga qarang). |
| `VITE_ENABLE_MOCK` | Faqat dev: backend o‘rniga brauzer ichidagi namuna server, doimiy ogohlantirish banneri bilan. API xatosida avtomatik yoqilmaydi. |
| `VITE_SHOW_DEMO_ACCOUNTS`, `VITE_DEMO_*` | Faqat dev: login sahifasida demo akkaunt tugmalari (qiymatlar backend seed bilan bir xil). |

Dev-only o‘zgaruvchilar production build’da berilsa, `vite build` **to‘xtaydi**; ular ishlatadigan kod
`import.meta.env.DEV` ortida dinamik import qilinadi va production bundle’ga kirmaydi. Tekshirish:
`npm run build && npm run verify:bundle`.

### Namuna rejimi (backend tayyor bo‘lmaganda)

```bash
VITE_ENABLE_MOCK=true VITE_SHOW_DEMO_ACCOUNTS=true \
VITE_DEMO_SUPER_ADMIN_PHONE=+998900000001 VITE_DEMO_SUPER_ADMIN_PASSWORD='DemoAdmin123!' \
VITE_DEMO_FARMER_PHONE=+998900000002 VITE_DEMO_FARMER_PASSWORD='DemoFarmer123!' npm run dev
```

Namuna serverda MFA kodi har doim `123456`. Ma’lumotlar faqat shu brauzer oynasining sessionStorage’ida.

## Buyruqlar

| Buyruq | Vazifasi |
| --- | --- |
| `npm run dev` | Vite dev server (5173) |
| `npm run build` | typecheck + production build (`dist/`) |
| `npm run verify:bundle` | `dist/`da demo parol, mock server, dev SMS inbox yo‘qligini tekshiradi |
| `npm run typecheck` | `tsc` (strict, `noUncheckedIndexedAccess`) |
| `npm run lint` | oxlint (react, jsx-a11y, import, vitest plaginlari) |
| `npm test` | Vitest + Testing Library (jsdom), 138 ta test |
| `npm run format` | Prettier |

## Tuzilma

```
src/
├── app/            router (rollar bo‘yicha himoyalangan, lazy sahifalar), layout, provider’lar, stillar
├── shared/         api (axios, refresh, xatolar), ui (dizayn tizimi), lib (Decimal, format, sana), hooks, types
├── features/       auth, profile, farms, animals, inventory, feed-inventory, feed-calculator,
│                   medicines, expenses, reports, users, audit
├── widgets/        tab-bar, header, profile-dropdown, dashboard-stats
├── pages/          auth, farmer, admin, profile
└── mocks/          kontraktga mos namuna server (testlar va VITE_ENABLE_MOCK uchun)
```

Har bir feature’da `api/` (tiplangan endpoint’lar), `model/` (TanStack Query hook’lari, sxemalar),
`components/` va `lib/` (sof funksiyalar) bor. Server ma’lumoti faqat TanStack Query’da; Zustand faqat
sessiya holati, tanlangan ferma va toast’lar uchun.

## Autentifikatsiya va sessiya

- Login: telefon + parol (`POST /auth/login`). SUPER_ADMIN/ADMIN uchun TOTP: birinchi kirishda QR (lokal
  chiziladi, secret uchinchi tomonga yuborilmaydi) va kod, keyingi kirishlarda faqat kod.
- **Access token faqat xotirada** (localStorage’da emas). Refresh token — HttpOnly cookie (`mf_rt` /
  `__Secure-mf_rt`, `Path=/api/v1/auth`); `/auth/refresh`ga `X-CSRF-Token` = `mf_csrf` cookie qiymati.
- Sahifa yangilanganda sessiya refresh cookie orqali tiklanadi. Bir vaqtdagi 401’lar uchun **bitta** refresh
  (single-flight) va tablar orasida **Web Locks** — refresh token rotatsiyasida “reuse” aniqlanib, sessiya
  yopilib qolmasligi uchun. Faqat guard’ning `401 UNAUTHORIZED` javobi refresh’ni ishga tushiradi
  (noto‘g‘ri joriy parol kabi biznes 401’lar emas).
- Refresh rad etilsa — sessiya tozalanadi, login sahifasi “Sessiya muddati tugadi” bilan; boshqa tabda chiqish
  BroadcastChannel orqali hamma tablarda amal qiladi.
- Rollar: FARMER → `/dashboard`; SUPER_ADMIN/ADMIN/SUPPORT → `/admin`; VET → `/admin/medicines`.
  Frontend’dagi yashirish xavfsizlik emas — backend har bir so‘rovni qayta tekshiradi, UI 403’ni ko‘rsatadi.

## Ma’lumotlar bilan ishlash qoidalari

- Pul va miqdorlar **Decimal satr** sifatida (`src/shared/lib/decimal.ts`, BigInt asosida); float hech qayerda
  hisoblashda ishlatilmaydi. UZS formati: `6 000 000 so‘m`, kasr vergul bilan.
- Ombor harakatlari `Idempotency-Key` bilan (har bir dialog sessiyasiga bitta kalit, qayta urinishda o‘sha kalit);
  qoldiqni faqat server hisoblaydi, `INSUFFICIENT_STOCK` maydon xatosi sifatida ko‘rsatiladi.
- So‘rovlarda faqat kontraktdagi query/body maydonlari yuboriladi (backend noma’lum maydonni 400 bilan rad etadi).
- Ro‘yxat endpoint’i hali yo‘q bo‘lsa (404) — “Backend’da hali ishga tushirilmagan” holati, soxta ma’lumot emas.
  Barcha bo‘shliqlar: [`docs/integration-gaps.md`](docs/integration-gaps.md).

## Production

Frontend va API **bitta domenda** bo‘lishi kerak (masalan nginx: `/` → `dist/`, `/api/v1` → backend), chunki
`__Host-mf_csrf` cookie’sini faqat o‘sha host’dagi sahifa o‘qiy oladi. Production build’da `VITE_API_BASE_URL`
berilmasa, default `/api/v1` (o‘sha domen).

- Backend’ning `CORS_ORIGINS`ida ilova manzili bo‘lishi **shart** (masalan `https://app.meningfermam.uz`), hatto
  bitta domenda ham: login/refresh’dagi CSRF tekshiruvi `Origin` sarlavhasini shu ro‘yxat bilan solishtiradi.
- SPA uchun barcha noma’lum yo‘llar `index.html`ga qaytarilishi kerak (`try_files $uri /index.html`).
- `dist/assets/*` uzoq keshlanadi (fayl nomlarida hash bor), `index.html` — `Cache-Control: no-cache`.

## Dizayn tizimi

Iliq “somon” palitrasi: `#FBF8F1` fon, oq kartalar (radius 14px, yupqa `#E8DCBF` chegara, yumshoq soya),
somon rang (`#C9A24A`) aktiv navigatsiya, tugmalar va urg‘ular uchun. Tokenlar `src/app/styles/index.css`da.
Kontrast: oddiy matn ≥ 4.5:1 (shuning uchun aktiv tab matni `#7C6122`); input chegaralari ≥ 3:1; focus halqasi
`#92620A`.

Navigatsiya — pastda suzib turadigan Telegram (iOS) uslubidagi tab-bar (`src/widgets/tab-bar`), har qanday
ekran kengligida bir xil. Fermer uchun: **Ombor** (chapda ochiladigan oynacha: Yem ombori, Yem hisoblagich;
belgida kam qolgan yemlar soni) · **Bosh sahifa** · **Dorixona** (oynacha o‘z tugmasi ustida: Dori ombori,
Molim kasal) · **Boshqa** (o‘ngda: Hayvonlar, Guruhlar, Hisobot · Fermalarim, Profil). Xodimlar uchun: Boshqaruv ·
Bosh sahifa · Boshqa (rol ko‘rmaydigan qatorlar va bo‘sh oynachalar chiqmaydi). “Molim kasal” (`/diseases`,
`src/features/diseases`): hayvon turi → kasallik guruhi → kasallik; nom/alomat bo‘yicha qidiruv; har bir kasallikda
manba matni to‘liq (o‘zgartirilmagan “Asl matn” bilan) va veterinar tasdig‘i haqida ogohlantirish. Matn backend’dagi
`prisma/data/kasalliklar-manba.txt`dan seed qilinadi; ilova tashxis qo‘ymaydi va doza hisoblamaydi. Xarajatlar alohida sahifa emas — Bosh sahifadagi “Xarajatlar” oynasi
(`/expenses` → `/dashboard#xarajatlar`). Grafik ranglari `src/shared/ui/charts.tsx`da — rang-ko‘rlik uchun
tekshirilgan, har bir grafik ostida aniq raqamli jadval bor.

## Yem ombori va Yem hisoblagich

- **Yem ombori** (`/feed`): yem nomi, miqdori, 1 kg narxi (`unitPrice`), qiymati va holati. Yem qo‘shishda
  boshlang‘ich miqdor va narx bitta so‘rovda yoziladi (`initialQuantity` → narxli IN harakati). Tahrirlash — nom,
  narx, minimal qoldiq; miqdor faqat inventarizatsiya harakati orqali. O‘chirish — tasdiqlash bilan arxivlash.
  Ombor qiymati = Σ miqdor × narx. `minQuantity`dan kam (yoki 0) qolgan yemlar ogohlantiriladi.
- **Yem hisoblagich** (`/feed-calculator`, `src/features/rations`): hayvon kategoriyalari (Buqa, Sigir, Qo‘chqor,
  Sovliq — backend birinchi so‘rovda bir marta yaratadi — va fermerning o‘z turlari). Har bir tur profil
  konfiguratsiyasi (`GET /rations/profiles`) bo‘yicha o‘z parametrlarini so‘raydi. Ratsion ombordagi yemlardan
  tuziladi; kunlik/umumiy sarf, kunlik/haftalik/oylik xarajat va yetarlilik Decimal bilan hisoblanadi
  (`lib/ration-math.ts`). Hisoblash va saqlash omborni o‘zgartirmaydi — qoldiq faqat “Sarfni ombordan
  chiqarish”da (`POST /rations/:id/issue`, Idempotency-Key, hammasi yoki hech narsa) kamayadi. Ratsionlarni
  saqlash, tahrirlash, nusxalash, o‘chirish va sarf tarixi backend’da. Oziqlantirish me’yori tavsiya qilinmaydi.
- **Bugungi ratsion** (Bosh sahifa, `TodayRations`): har bir ratsion — bitta slayd (telefonda surib ko‘riladi).
  Bugun berilgan/berilmagani `lastIssue`dan hisoblanadi (N kunlik sarf o‘z sanasidan N kunni qoplaydi, Toshkent
  vaqti). “Berildi — tasdiqlash” bir kunlik sarfni ombordan chiqaradi — tasdiq shu yozuvning o‘zi.
