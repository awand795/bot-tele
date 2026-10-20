# bot-tele

Telegram downloader bot yang berjalan **100% di Cloudflare Workers** (tanpa VPS).

Bot: [@adnawaa_bot](https://t.me/adnawaa_bot)
Worker: https://bot-tele.awand795.workers.dev

---

## Fitur

| Platform | Yang didukung | Status |
| --- | --- | --- |
| **YouTube** | Video 360p (muxed, ada suara) + Audio M4A | ✅ jalan |
| **TikTok** | Video HD, slideshow foto, audio | ✅ jalan |
| **Facebook** | Video / Reel publik | ✅ jalan |
| **Instagram** | Post / Reel / carousel | ⚠️ best-effort (sering kena rate limit IG) |
| **TeraBox** | Browse folder + link download + kirim file | ⚠️ butuh cookie akun |
| **Story** | — | 🚧 segera hadir |

### Batas pengiriman file

| Ukuran | Perlakuan |
| --- | --- |
| ≤ 20 MB | Telegram ambil sendiri dari proxy Worker (`/dl/...`) |
| 20–45 MB | Bot upload streaming ke Bot API |
| > 45 MB | Dikirim sebagai link download |

Rate limit: **12 request / jam / user**.

---

## Struktur

```
src/
  index.ts              # router HTTP: /tg/<secret>, /dl/<token>, /health
  router.ts             # logika bot (command, menu, callback)
  menus.ts              # teks & keyboard
  telegram.ts           # wrapper Bot API + upload multipart streaming
  sender.ts             # strategi kirim: URL → upload → link
  resolve.ts            # resolve payload → stream upstream
  crypto.ts             # HMAC signed link
  state.ts              # KV: state user, grup action, cache
  ratelimit.ts          # 12 req/jam
  extract/
    index.ts            # deteksi platform
    terabox.ts          # direct TeraBox API (butuh cookie)
    tiktok.ts           # tikwm + fallback scrape halaman
    youtube.ts          # Innertube ANDROID_VR (itag 18 & 140)
    instagram.ts        # web API → app API → embed
    facebook.ts         # plugin video → embed → page
scripts/
  set-webhook.mjs
  webhook-info.mjs
```

Penyimpanan: **Cloudflare KV** (`BOT_KV`) untuk state, cache link, rate limit, dan dedupe update.

---

## Command

| Command | Fungsi |
| --- | --- |
| `/start` | Menu utama |
| `/help` | Bantuan |
| `/id` | Lihat chat ID & user ID |
| `/cancel` | Batalkan input |

Kirim link langsung (tanpa menu) juga bisa — platform dideteksi otomatis.

---

## TeraBox (opsional, butuh cookie)

TeraBox memblokir request anonim dengan captcha (`verify_v2`). Supaya fitur TeraBox aktif, isi cookie akun TeraBox kamu:

1. Login ke https://www.terabox.com di browser.
2. Buka DevTools → tab **Network** → klik salah satu request ke `terabox.com`.
3. Copy nilai header **Cookie** (satu baris panjang, mengandung `ndus=...`).
4. Simpan sebagai secret:

```powershell
$env:CLOUDFLARE_API_TOKEN="<token>"
$env:CLOUDFLARE_ACCOUNT_ID="435041e8474f1b516f70213b23c7e507"
"<COOKIE_TERABOX>" | npx wrangler secret put TERABOX_COOKIE
```

Cookie akan kedaluwarsa sewaktu-waktu; kalau TeraBox error lagi, ulangi langkah di atas.

Tanpa cookie, menu TeraBox tetap muncul tapi akan menjawab bahwa fitur butuh cookie.

---

## Development

```powershell
npm install
npx wrangler dev          # lokal
npx tsc --noEmit          # typecheck
npx wrangler deploy       # deploy
```

Set secret:

```powershell
"<BOT_TOKEN>"        | npx wrangler secret put BOT_TOKEN
"<WEBHOOK_SECRET>"   | npx wrangler secret put WEBHOOK_SECRET
```

Daftarkan webhook:

```powershell
$env:BOT_TOKEN="<BOT_TOKEN>"
$env:WEBHOOK_SECRET="<WEBHOOK_SECRET>"
$env:PUBLIC_URL="https://bot-tele.awand795.workers.dev"
node scripts/set-webhook.mjs
```

Cek webhook:

```powershell
$env:BOT_TOKEN="<BOT_TOKEN>"; node scripts/webhook-info.mjs
```

---

## Debug (butuh `WEBHOOK_SECRET`)

```
GET /_debug?key=<secret>&url=<link>          # hasil ekstraksi (tanpa kirim ke Telegram)
GET /_link?key=<secret>&url=<link>&mode=audio # signed /dl URL untuk tes streaming
GET /_probe?key=<secret>&url=<url>           # probe outbound request
GET /health
```

---

## Catatan keamanan

- Token Cloudflare & token bot pernah muncul di chat. **Rotasi setelah bot stabil.**
- Simpan kredensial hanya sebagai Worker secret, jangan di file.
- `.webhook-secret.local` hanya untuk lokal dan sudah di-ignore git.
