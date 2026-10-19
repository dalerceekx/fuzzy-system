# Integratsiya bo‘shliqlari (frontend ↔ backend)

Frontend faqat backend kontraktidagi endpoint’larni chaqiradi (`CONTRACT.md` §4–§7).
Backend’da yo‘q funksiyalar **soxta ma’lumot yoki soxta muvaffaqiyat bilan
almashtirilmaydi** — ular “Tez orada / Backend’da hali mavjud emas” holatida
ko‘rsatiladi. Quyida har bir bo‘shliq, foydalanuvchi nima ko‘rishi va backend’da
nima kerakligi.

| Funksiya (prompt) | Frontend’da hozir | Backend’da kerak bo‘ladigan narsa |
| --- | --- | --- |
| Hayvon guruhlari (yaratish, nom, yosh toifasi) | `/animal-groups`: tur bo‘yicha **avtomatik** guruhlar (server `total` qiymatlari) + “Tez orada” bloki. Dashboard kartasi “—” va “Tez orada”. | `AnimalGroup` modeli va CRUD (`/animal-groups`), hayvon ↔ guruh bog‘lanishi. |
| Xarajatlar (transport, ish haqi, boshqa) | Bosh sahifadagi “Xarajatlar” oynasi (`/expenses` → `/dashboard#xarajatlar`): faqat omborga **narxi bilan** kiritilgan xaridlar (IN + `unitCost`) — summalar aniq, har bir yozuv “Ombordan” va o‘zgarmaydi (harakatlar faqat qo‘shiladi). “Xarajat qo‘shish” — mahsulot tanlanib, xarid sifatida yoziladi. Tahrirlash/o‘chirish va ombordan tashqari xarajatlar yo‘q. | `Expense` modeli (summa Decimal, toifa, sana, ferma) va `/expenses` CRUD + filtrlash. |
| Oylik xarajatlar (dashboard) | Shu oyning ombor xaridlari, karta ostida “ombor xaridlari asosida” deb yozilgan; oxirgi 6 oy grafigi — Hisobotlarda. | Yuqoridagi `Expense` moduli qo‘shilgach unga ulanadi. |
| Oziqlantirish me’yorlari (ratsion uchun) | Yem hisoblagich faqat fermer kiritgan miqdorlarni hisoblaydi; me’yor tavsiya qilinmaydi va ratsion “veterinariya jihatidan to‘g‘ri” deb baholanmaydi. Qaysi parametrlar so‘ralishi — `GET /rations/profiles` konfiguratsiyasi. | Veterinar tasdiqlagan me’yorlar jadvali (tur, vazn, maqsad bo‘yicha) va ularni ko‘rsatish qoidalari. |
| Hisobotlar | Faqat backend ma’lumotidan hisoblanadiganlari: hayvonlar turi/yoshi, oylik yem sarfi (OUT), yem xaridi, oylik xarajatlar va taqsimot (xaridlar), dori yaroqliligi. | Katta fermalar uchun server tomonida agregatsiya (`/reports/...`) — hozir harakatlar mahsulot bo‘yicha yuklanib, brauzerda yig‘iladi (200 mahsulot / 1 000 harakat cheklovi, oshsa ogohlantirish chiqadi). |
| Fermadagi barcha ombor harakatlari | Mahsulotlar bo‘yicha `GET /inventory/items/:id/movements` chaqirib yig‘iladi (4 ta parallel so‘rov). | `GET /inventory/movements?farmId=&from=&to=` — bitta paginatsiyalangan ro‘yxat. |
| Hayvonlarni matn bo‘yicha qidirish, yosh toifasi filtri | Ferma hayvonlari to‘liq yuklanadi (100 tadan, 2 000 gacha), qidiruv/filtr brauzerda — natija to‘liq ro‘yxat bo‘yicha. | `GET /animals?q=&bornAfter=&bornBefore=` — server tomonida filtr. |
| Optional maydonni tozalash (masalan hayvon izohini o‘chirish) | Ruxsat berilmaydi: “Avval kiritilgan qiymatni o‘chirib bo‘lmaydi” xabari. | PATCH DTO’da `null` qabul qilish (`@ValidateIf`). |
| Email qo‘shish va tasdiqlash | `/profile/email`: joriy email (bo‘lsa) va “Tez orada” holati. Hech qanday soxta “kod yuborildi” yo‘q. | `/auth/email` (qo‘shish), `/auth/email/verify` (kod), `emailVerifiedAt` maydoni. |
| Email + parol bilan kirish | Login sahifasida faqat telefon; pastida “tez orada” izohi. | `/auth/login` email’ni ham qabul qilishi (faqat tasdiqlangan email). |
| Telefon + SMS kod (OTP) bilan kirish | Ko‘rsatilmaydi (“tez orada” izohi). OTP faqat ro‘yxatdan o‘tish va parol tiklashda ishlatiladi — ular to‘liq ulangan. | `/auth/otp-login/request`, `/auth/otp-login/verify`. |
| Bildirishnomalar | Header’da tugma **yo‘q** (prompt: faqat backend qo‘llasa). | Notifications API. |
| Admin “Sozlamalar” | `/admin/settings`: “Tez orada”. | Settings API. |
| Rollarni boshqarish (yangi rol/huquq yaratish) | `/admin/roles`: faqat o‘qish uchun huquqlar jadvali (backend qoidalari asosida) + rollar bo‘yicha sonlar. Rol berish — foydalanuvchi sahifasida (`PATCH /admin/users/:id/role`). | Rollar serverda qat’iy enum; dinamik rollar kerak bo‘lsa — alohida RBAC modeli. |
| Dorilar katalogi filtrlari | `GET /vet/medicines` faqat `page/limit` bilan; holat bo‘yicha filtr brauzerda (katalog to‘liq yuklanadi). | `status` query parametri (ixtiyoriy). |

## Backend’da bor, frontend’da hali yo‘q (keyingi bosqich)

- **Davolash (treatments), protokollar, tavsiyalar** (`/vet/treatments`, `/vet/protocols`, `/vet/recommendations`) —
  prompt dozalash/davolash protokollarini o‘ylab topishni taqiqlaydi; UI faqat veterinar tasdiqlagan ma’lumotni
  ko‘rsatadigan qilib alohida loyihalanadi.
- **Fayllar** (`/files`: hayvon rasmi, hujjatlar) — yuklash faqat backend orqali bo‘ladi (brauzer S3/MinIO’ga to‘g‘ridan-to‘g‘ri ulanmaydi).
- **Ro‘yxatdan o‘tgan foydalanuvchining o‘z profilini tahrirlash** (ism) — backend’da `/auth/me` PATCH yo‘q.

## Tekshirish usuli

Endpoint hali deploy qilinmagan bo‘lsa (backend noma’lum yo‘lga 404 qaytaradi), ro‘yxat sahifalari
“Bu bo‘lim backend’da hali ishga tushirilmagan” holatini ko‘rsatadi — bu `src/app/layout.test.tsx`da sinalgan.
