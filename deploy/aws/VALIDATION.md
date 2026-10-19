# AWS tayyorgarlik tekshiruvi — 2026-10-19

Mo‘ljal: `riizq.uz`, bitta EC2/Lightsail Ubuntu 24.04 LTS serveri.

| Tekshiruv | Natija |
| --- | --- |
| Backend unit testlari | 929 test, 53 fayl — o‘tdi |
| Frontend testlari | 170 test, 16 fayl — o‘tdi |
| Production config generator | 3 test — o‘tdi; fresh secrets, 0600/0700, overwrite refusal, raw password transport |
| Backend typecheck, lint, format | o‘tdi |
| Frontend Docker build/typecheck/bundle verification | o‘tdi; same-origin `/api/v1`, demo kodi yo‘q |
| API va web Docker image | `20261019-initial` taglari yig‘ildi; UID 10001 |
| Migratsiya va kasallik ma’lumotnomasi | yangi DB’da va takroriy ishga tushirishda o‘tdi |
| Runtime DB huquqlari | schema CREATE, audit UPDATE, farm DELETE rad; user INSERT ruxsat |
| Backup/restore | read-only backup roli dump qildi; alohida DB’da data va grant’lar tiklandi |
| HTTPS smoke | ishonilgan lokal CA, redirect, SPA, asset cache/404, API routing, dependency health, private portlar |
| Trivy API va web | `HIGH,CRITICAL --ignore-unfixed` filtri bilan 0 finding, exit 0 |
| Source arxivi | checksum, `.env*` va haqiqiy private qiymatlar yo‘qligi tekshirildi |

Caddy’ning rasmiy tayyor 2.11.7 image’ida 4 ta fixable HIGH finding aniqlandi.
Shu release Go 1.27.2 va `golang.org/x/net` 0.60.0 bilan qayta yig‘ilgach,
yakuniy image skani o‘tdi. Versiyalar `apps/frontend/caddy/go.mod` va `go.sum`
orqali saqlanadi; CI ikkala image’ni qayta skanerlaydi.

Lokal `.deploy/aws/api.env` preflight’i hozir **S3_BUCKET va S3_REGION**
yetishmagani sababli release’ni rad etadi. Shu ikki maydon faqat offline
tekshiruvda vaqtincha berilganda qolgan production config tekshiruvi o‘tdi;
haqiqiy faylda taxminiy bucket/region yozilmadi.

Tashqi muhitda hali bajariladigan ishlar:

- AWS S3 bucket/region, IAM va serverdagi credential/role ruxsatlari;
- `riizq.uz` DNS va public ACME sertifikati;
- Eskiz sender/shablon/balans va haqiqiy SMS yetkazilishi;
- operatorning age public kaliti, shifrlangan off-server backup va monitoring;
- haqiqiy trafik bo‘yicha yuklama testi.

Lokal smoke AWS/SMS’ga murojaat qilmaydi; MinIO va Caddy internal CA ishlatadi.
PostgreSQL dump/restore sinovdan o‘tdi; operator kaliti bilan age encryption va
AWS backup upload hali bajarilmadi. Production AWS resurslari yaratilmadi,
serverga deploy qilinmadi, haqiqiy SMS yuborilmadi. Testlar faqat o‘zining
vaqtinchalik Compose project, konteyner va volume’larini o‘chiradi.
