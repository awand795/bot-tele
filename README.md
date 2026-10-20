# bot-tele

Bot downloader Telegram yang berjalan **100% di Cloudflare Workers** — tanpa VPS, tanpa server sendiri.

- **Bot:** https://t.me/adnawaa_bot
- **Worker:** https://bot-tele.awand795.workers.dev
- **Repo:** https://github.com/awand795/bot-tele

---

## Status fitur

| Platform | Yang didukung | Status | Catatan |
| --- | --- | --- | --- |
| **YouTube** | Video 360p (muxed, ada suara) + audio M4A | ✅ stabil | Tanpa remux, sesuai batas free plan |
| **TikTok** | Video HD, slideshow foto, audio | ✅ stabil | tikwm + fallback scrape halaman |
| **Facebook** | Video / Reel publik | ✅ stabil | Plugin embed + regex halaman |
| **Instagram** | Post / Reel / carousel | ⚠️ best-effort | Sering `429` dari IP Cloudflare |
| **TeraBox** | Browse folder + download | ⏸️ pending | Butuh cookie akun (lihat bagian TeraBox) |
| **Story** | — | 🚧 segera hadir | Placeholder menu |

### Batas pengiriman file

| Ukuran file | Perlakuan |
| --- | --- |
| ≤ 20 MB | Telegram mengambil sendiri dari signed URL `/dl/...` |
| 20–45 MB | Bot upload streaming ke Bot API |
| > 45 MB | Dikirim sebagai link download |

- Rate limit: **12 request/jam/user**.
- Update Telegram di-dedupe (`upd:<update_id>`, TTL 5 menit) supaya tidak diproses dua kali saat retry.

---

## Cara pakai bot

1. Buka bot → tekan **/start**.
2. Pilih menu **TeraBox / Sosmed / YouTube**, atau langsung kirim link.
3. Klik tombol download yang muncul.

Command yang tersedia:

| Command | Fungsi |
| --- | --- |
| `/start` | Menu utama |
| `/help` | Bantuan |
| `/id` | Lihat chat ID & user ID |
| `/cancel` | Batalkan input |

---

## Kendala yang diketahui (selain TeraBox)

### 1. Instagram sering `429 Too Many Requests`

**Penyebab:** Instagram membatasi IP datacenter, sedangkan Worker Cloudflare memakai IP egress bersama.

**Yang sudah dicoba:**

- `www.instagram.com/api/v1/media/{code}/info/` + header `x-ig-app-id` → `429`
- `i.instagram.com/api/v1/media/{code}/info/` (UA aplikasi) → `403 login_required`
- `/{code}/embed/captioned/` → `200`, tetapi hanya berhasil untuk post yang masih hidup

**Rencana lanjutan:**

- Tambah fallback endpoint `graphql/query` dengan `doc_id`.
- Coba varian embed `?__a=1&__d=dis`.
- Jika tetap gagal, tampilkan pesan yang lebih jelas dan sarankan link TikTok/Facebook.

### 2. TikTok `Free Api Limit: 1 request/second`

**Penyebab:** tikwm membatasi 1 request/detik per IP, dan IP Worker dipakai bersama.

**Solusi yang sudah jalan:** fallback scrape halaman TikTok melalui
`__UNIVERSAL_DATA_FOR_REHYDRATION__`, sehingga video/foto/audio tetap bisa diambil.

**Rencana lanjutan:** cache hasil per URL selama 5–10 menit untuk mengurangi request.

### 3. YouTube hanya tersedia 360p

**Penyebab:** free plan tidak memungkinkan remux/ffmpeg. Format muxed yang tersedia tanpa remux adalah **itag 18 (360p)**.

**Yang dipakai:** Innertube client `ANDROID_VR` v1.60.19:

- `itag 18` → video 360p (gambar + suara)
- `itag 140` → audio M4A

**Catatan:** HLS (`itag 230/231/232`) sebenarnya muxed, tetapi berformat MPEG-TS sehingga butuh remux — di luar scope free plan.

**Rencana lanjutan:** jika upgrade ke Workers Paid, tambahkan remux (ffmpeg.wasm / container) untuk 720p+.

### 4. Batas Cloudflare Workers Free

- **CPU 10 ms/request** → tidak ada remux/transcode.
- **KV 1.000 write/hari** → dipakai untuk state, cache, rate limit, dan dedupe.
- **Tanpa Durable Objects** di free plan.

**Rencana lanjutan:** kurangi jumlah write dengan menggabungkan state + rate limit dalam satu key.

### 5. Batas Telegram

- URL fetch maksimal **20 MB**, multipart maksimal **50 MB** → bot memakai threshold **45 MB**.
- Upload streaming memakai `Content-Length`; jika runtime menolak, otomatis fallback ke link.
- Video > 45 MB selalu dikirim sebagai link.

### 6. Webhook dan retry

Telegram mengirim ulang update jika respons lambat. Bot menyimpan `upd:<update_id>` di KV (TTL 5 menit) untuk mencegah proses ganda.

---

## Arsitektur

```
Telegram ──POST /tg/<secret>──► router
                                ├─ extract (YouTube / TikTok / IG / FB)
                                ├─ signed link / upload / link
                                └─ balas pesan + inline keyboard

Telegram ──GET /dl/<token>──► verifikasi HMAC ──► resolve upstream ──► stream (Range)
```

- **Signed URL** memakai HMAC-SHA256 (`WEBHOOK_SECRET`) dengan masa berlaku 2 jam.
- Payload link menyimpan **instruksi**, bukan URL mentah:
  - `yt` → resolve ulang Innertube saat file diunduh
  - `tb` → resolve ulang TeraBox
  - `u` → fetch URL langsung
- Tujuannya agar link CDN yang kedaluwarsa tidak membuat download gagal.

---

## Struktur file

```
src/
  index.ts          # HTTP router: /tg, /dl, /health, debug
  router.ts         # command, menu, callback, flow TeraBox
  menus.ts          # teks & keyboard
  telegram.ts       # wrapper Bot API + multipart streaming
  sender.ts         # strategi kirim: URL → upload → link
  resolve.ts        # payload → stream upstream
  crypto.ts         # HMAC signed link
  state.ts          # KV state, grup action, cache
  ratelimit.ts      # 12 request/jam
  extract/
    index.ts        # deteksi platform
    youtube.ts      # Innertube ANDROID_VR
    tiktok.ts       # tikwm + scrape fallback
    instagram.ts    # web API → app API → embed
    facebook.ts     # plugin → embed → page
    terabox.ts      # direct API + cookie (pending)
    types.ts
scripts/
  set-webhook.mjs
  webhook-info.mjs
```

---

## Setup dari nol

```powershell
git clone https://github.com/awand795/bot-tele.git
cd bot-tele
npm install
```

### 1. Buat KV namespace

```powershell
$env:CLOUDFLARE_API_TOKEN="<TOKEN_CLOUDFLARE>"
$env:CLOUDFLARE_ACCOUNT_ID="<ACCOUNT_ID>"
npx wrangler kv namespace create BOT_KV
```

Salin `id` yang muncul ke `wrangler.jsonc` pada bagian `kv_namespaces`.

### 2. Set secret

```powershell
"<BOT_TOKEN>"      | npx wrangler secret put BOT_TOKEN
"<WEBHOOK_SECRET>" | npx wrangler secret put WEBHOOK_SECRET
```

`WEBHOOK_SECRET` adalah string acak 32 karakter hex (`[A-Za-z0-9_-]`). Nilai ini dipakai untuk:

- path webhook `/tg/<secret>`
- header `X-Telegram-Bot-Api-Secret-Token`
- signing URL `/dl/<token>`

### 3. Deploy

```powershell
npx wrangler deploy
```

### 4. Daftarkan webhook

```powershell
$env:BOT_TOKEN="<BOT_TOKEN>"
$env:WEBHOOK_SECRET="<WEBHOOK_SECRET>"
$env:PUBLIC_URL="https://bot-tele.awand795.workers.dev"
node scripts/set-webhook.mjs
```

Cek status webhook:

```powershell
$env:BOT_TOKEN="<BOT_TOKEN>"; node scripts/webhook-info.mjs
```

---

## Development lokal

Buat file `.dev.vars` (jangan di-commit):

```
BOT_TOKEN=...
WEBHOOK_SECRET=...
```

Jalankan:

```powershell
npx wrangler dev
npx tsc --noEmit
```

Untuk menerima webhook saat development, gunakan tunnel (cloudflared/ngrok), lalu daftarkan URL tunnel sebagai webhook.

---

## Debug endpoint (butuh `WEBHOOK_SECRET`)

| Endpoint | Fungsi |
| --- | --- |
| `GET /health` | Cek Worker hidup |
| `GET /_debug?key=&url=` | Hasil ekstraksi tanpa mengirim ke Telegram |
| `GET /_link?key=&url=&mode=audio` | Signed `/dl` URL untuk tes streaming |
| `GET /_send?key=&chat=&url=&mode=` | Tes kirim langsung ke chat |
| `GET /_chats?key=` | Daftar chat yang pernah `/start` |
| `GET /_probe?key=&url=` | Probe request keluar (diagnosa) |

Contoh:

```
/_debug?key=SECRET&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ
```

---

## Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| Bot diam saja | Webhook salah / secret beda | Cek `webhook-info.mjs`, lihat `last_error_message` |
| `401 Unauthorized` dari Telegram | `BOT_TOKEN` salah | Set ulang secret `BOT_TOKEN` |
| Video gagal terkirim | Telegram gagal fetch `/dl` | Tes `/_link`, pastikan Range `206` |
| `429` Instagram | Rate limit IP | Tunggu beberapa saat / pakai link lain |
| `Free Api Limit` TikTok | Limit tikwm | Fallback scrape otomatis aktif |
| Upload > 20 MB gagal | `Content-Length` pada stream | Fallback ke link (memang desain) |
| KV write habis | Batas 1.000/hari | Kurangi cache/state write |

---

## Roadmap di rumah

- [ ] Instagram: fallback GraphQL + pesan error lebih jelas
- [ ] TikTok: cache hasil per URL
- [ ] YouTube: opsi kualitas lain saat sudah pakai Paid plan
- [ ] Album/carousel: caption per item
- [ ] Tes upload streaming 20–45 MB dengan file nyata
- [ ] Tes end-to-end dari Telegram (video, audio, foto)
- [ ] Rotasi token Cloudflare & token bot
- [ ] TeraBox: lanjutkan setelah cookie tersedia

---

## TeraBox (pending)

TeraBox menolak request anonim dengan captcha (`verify_v2`). Supaya aktif, perlu cookie akun TeraBox yang disimpan sebagai secret `TERABOX_COOKIE`. Tanpa cookie, menu TeraBox tetap tampil tetapi menjawab bahwa fitur sedang butuh cookie.

---

## Keamanan

- Token Cloudflare dan token bot **pernah terekspos di chat** → rotasi setelah bot stabil.
- Jangan pernah commit `.dev.vars`, `.webhook-secret.local`, atau cookie apa pun.
- Repo ini **public** — kredensial hanya boleh disimpan sebagai **Worker secrets**.
- `.gitignore` sudah mencakup:
  `node_modules/`, `.wrangler/`, `.dev.vars`, `*.log`, `.env`, `.webhook-secret.local`.

---

## Lisensi

MIT
