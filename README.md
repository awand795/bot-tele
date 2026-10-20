# bot-tele

Asisten pribadi Telegram yang berjalan **100% di Cloudflare Workers** — tanpa VPS, tanpa server sendiri.
Dimulai sebagai downloader, sekarang juga punya tools, vault file, AI, monitor, dan admin.

- **Bot:** https://t.me/adnawaa_bot
- **Worker:** https://bot-tele.awand795.workers.dev
- **Repo:** https://github.com/awand795/bot-tele

---

## Fitur

Menu utama: **Download · Tools · Vault · AI · Monitor · Setting**

### ⬇️ Download

| Platform | Yang didukung | Status | Catatan |
| --- | --- | --- | --- |
| **YouTube** | Video 360p (muxed, ada suara) + audio M4A | ✅ stabil | Tanpa remux, sesuai batas free plan |
| **TikTok** | Video HD, slideshow foto, audio | ✅ stabil | tikwm + fallback scrape halaman |
| **Facebook** | Video / Reel publik | ✅ stabil | Plugin embed + regex halaman |
| **Instagram** | Post / Reel / carousel | ⚠️ best-effort | Sering `429` dari IP Cloudflare |
| **TeraBox** | Browse folder + download | ⏸️ pending | Butuh cookie akun, lihat bagian TeraBox |
| **Story** | — | 🚧 placeholder | Butuh sesi login |

Batas pengiriman file:

| Ukuran | Perlakuan |
| --- | --- |
| ≤ 20 MB | Telegram mengambil sendiri dari signed URL `/dl/...` |
| 20–45 MB | Bot upload streaming ke Bot API |
| > 45 MB | Dikirim sebagai link download |

- Rate limit download: **12 request/jam/user**.
- Update Telegram di-dedupe (`upd:<update_id>`, TTL 5 menit).

### 🧰 Tools

| Command | Fungsi | Sumber |
| --- | --- | --- |
| `/qr <teks>` | QR code | api.qrserver.com |
| `/cuaca <kota>` | Cuaca sekarang + 3 hari | Open-Meteo |
| `/sholat <kota>` | Jadwal sholat hari ini | Aladhan (Kemenag) |
| `/kurs USD` / `/kurs 100 USD IDR` | Kurs mata uang | open.er-api.com |
| `/lirik <judul>` | Lirik lagu | lyrics.ovh |
| `/paste <teks>` | Paste publik 30 hari (`/p/<slug>`) | D1 |
| `/get <slug>` | Ambil isi paste | D1 |
| `/cari <judul>` | Cari video YouTube, langsung bisa download | Innertube |

### 🗂 Vault & produktivitas

- Kirim **dokumen / video / audio / foto / voice** ke bot → otomatis tersimpan di vault.
- File aslinya **tetap di server Telegram**; bot hanya menyimpan `file_id` + metadata di D1.
- `/vault` → daftar file, tombol kirim ulang / hapus.
- `/note`, `/notes`, `/todo`, `/todos`, `/done`, `/remind`, `/reminders`.

Format pengingat (WIB):

```
/remind 07:30 sarapan
/remind 2026-10-21 09:00 meeting
```

### 🤖 AI (Cloudflare Workers AI)

| Command | Model |
| --- | --- |
| `/ai <pertanyaan>` | Llama 3.3 70B (fallback Llama 3.1 8B / 3.2 3B) |
| `/ringkas <url\|teks>` | Llama 3.3 70B |
| `/tr en <teks>` | Llama 3.3 70B |
| `/img <prompt>` | FLUX.1 schnell |
| `/tts <teks>` | MeloTTS (dikirim sebagai file WAV) |
| `/stt` (reply voice) | Whisper |

- Kuota **20 request/hari/user** (`ai_usage` di D1).
- Chat menyimpan konteks 5 pesan terakhir di KV (TTL 1 jam).
- Tidak perlu API key eksternal — cukup binding `AI`.

### 📡 Monitor

| Command | Fungsi | Jadwal default |
| --- | --- | --- |
| `/rss add <url> [menit\|cron]` | Notifikasi item RSS/Atom baru (maks 5/user) | 10 menit |
| `/monitor add <url> [menit\|cron]` | Notifikasi website up/down (maks 5/user) | 5 menit |
| `/alert BTC > 100000 [menit\|cron]` | Alert harga crypto USD (maks 10/user) | 15 menit |
| `/gh owner/repo` | Notifikasi GitHub (push, issue, PR, release, workflow) | realtime webhook |

- Cron Worker tetap jalan **tiap menit**. Item interval dicek jika `last_checked + interval_min` sudah lewat; item cron dicek jika `next_run_at` sudah lewat.
- Interval per item: `/monitor every <id> <menit>`, `/rss every <id> <menit>`, `/alert every <id> <menit>`.
- Cron per item: `/monitor cron <id> <expr>`, `/rss cron <id> <expr>`, `/alert cron <id> <expr>`. Pakai `off` untuk kembali ke interval.
- `/monitor` tanpa argumen menampilkan daftar; klik item untuk **cek sekarang**, pilih **1m/5m/15m/60m**, **jeda/aktifkan**, atau hapus.
- Default item baru diatur owner lewat `/cron` dan `/cron set monitor|rss|alert <menit|expr>`.
- Status uptime: 🟢 **up** (2xx–3xx), 🟡 **terproteksi** (401/403/429 — server merespons tapi akses dibatasi), 🔴 **down** (5xx, timeout, 4xx lain).
- Harga: CoinGecko, fallback Binance jika kena rate limit.
- GitHub webhook: `POST /gh/<WEBHOOK_SECRET>`, signatura `X-Hub-Signature-256` diverifikasi.

#### Cron expression

Format 5 field: **menit jam tanggal bulan hari**, dievaluasi sebagai **WIB (UTC+7)**.

```text
*/5 * * * *        setiap 5 menit
0 9 * * 1-5        Senin–Jumat 09:00 WIB
30 7 1 * *         tanggal 1 tiap bulan 07:30 WIB
0 0 * * SUN        Minggu 00:00 WIB
0 9,18 * * *       09:00 dan 18:00 WIB
```

Didukung: `*`, `*/n`, `a`, `a-b`, `a-b/n`, `a/n`, daftar (`1,15,30`), nama bulan (`JAN`–`DEC`), nama hari (`SUN`–`SAT`), `7` = Minggu. Tanggal dan hari memakai semantik **OR** bila keduanya dibatasi. Jadwal yang terlalu rapat ditolak: monitor minimal 1 menit, RSS/alert minimal 5 menit. Gunakan `/cron test <expr>` untuk melihat 5 jadwal berikutnya.

> Trigger Cloudflare tetap `* * * * *`; ekspresi cron disimpan di D1 dan dievaluasi oleh bot. Trigger deploy tidak bisa diubah lewat command.

### ⚙️ Setting & admin

| Command | Akses | Fungsi |
| --- | --- | --- |
| `/id` | semua | Chat ID & user ID |
| `/status` | semua | Status D1, KV, AI, webhook, GitHub |
| `/backup` | semua | Backup data user ke JSON |
| `/allow <id>` | owner | Izinkan user |
| `/deny <id>` | owner | Blokir user |
| `/users` | owner | Daftar user |
| `/stats` | owner | Statistik hari ini |
| `/audit` | owner | Audit log terakhir |
| `/gh owner/repo` | owner | Aktifkan notifikasi GitHub |
| `/cron` | owner | Lihat antrean & jadwal default |
| `/cron set <monitor\|rss\|alert> <menit\|expr>` | owner | Ubah jadwal default item baru |
| `/cron test <expr>` | owner | Lihat 5 jadwal berikutnya (WIB) |

- User pertama yang `/start` menjadi **owner**.
- User lain masuk status **pending** sampai di-`/allow`.
- Owner otomatis mendapat notifikasi saat ada user baru.

---

## Arsitektur

```
Telegram ──POST /tg/<secret>──► router
                                ├─ downloader (YouTube/TikTok/IG/FB/TeraBox)
                                ├─ tools / vault / AI / monitor / admin
                                ├─ inline query
                                └─ balas pesan + inline keyboard

Telegram ──GET /dl/<token>──► verifikasi HMAC ──► resolve upstream ──► stream (Range)
Browser  ──GET /p/<slug>──► halaman paste (HTML)
GitHub   ──POST /gh/<secret>──► verifikasi HMAC ──► notifikasi ke chat
Cron     ──* * * * *──► reminder · uptime · RSS · alert
```

Binding:

| Binding | Fungsi |
| --- | --- |
| `BOT_KV` | state flow, cache YouTube, rate limit, dedupe update, chat registry |
| `DB` (D1) | user, vault index, notes, todos, reminders, pastes, feeds, monitors, alerts, AI usage, stats, audit, settings |
| `AI` | Workers AI |
| `secrets` | `BOT_TOKEN`, `WEBHOOK_SECRET`, `TERABOX_COOKIE` (opsional) |

### Signed URL

HMAC-SHA256 (`WEBHOOK_SECRET`), berlaku 2 jam. Payload menyimpan **instruksi**, bukan URL mentah:

- `yt` → resolve ulang Innertube saat diunduh
- `tb` → resolve ulang TeraBox
- `u` → fetch URL langsung

Tujuannya agar link CDN yang kedaluwarsa tidak membuat download gagal.

### Tabel D1

```sql
users(id, username, first_name, role, created_at)
vault(id, user_id, file_id, file_unique_id, kind, name, size, mime, caption, created_at)
notes(id, user_id, text, created_at)
todos(id, user_id, text, done, created_at)
reminders(id, user_id, chat_id, text, due_at, sent, created_at)
pastes(slug, user_id, text, created_at, expires_at)
feeds(id, user_id, chat_id, url, title, last_seen, last_checked, created_at)
feeds(id, user_id, chat_id, url, title, last_seen, last_checked, interval_min, cron_expr, next_run_at, created_at)
monitors(id, user_id, chat_id, url, status, last_checked, interval_min, paused, cron_expr, next_run_at, created_at)
alerts(id, user_id, chat_id, symbol, op, target, triggered, interval_min, last_checked, cron_expr, next_run_at, created_at)
ai_usage(user_id, day, count)
stats(day, feature, count)
audit(id, user_id, action, meta, created_at)
settings(key, value)
```

Skema lengkap: [`schema.sql`](schema.sql).

---

## Struktur file

```
src/
  index.ts              # HTTP router: /tg, /dl, /p, /gh, /health, debug
  router.ts             # dispatch update, menu, callback, flow TeraBox
  menus.ts              # teks & keyboard semua menu
  telegram.ts           # wrapper Bot API, multipart streaming & bytes
  sender.ts             # strategi kirim: URL → upload → link
  resolve.ts            # payload → stream upstream
  crypto.ts             # HMAC signed link
  state.ts              # KV state, grup action, cache
  ratelimit.ts          # 12 download/jam
  db.ts                 # helper D1
  users.ts              # user & whitelist
  time.ts               # WIB & parser reminder
  cron-expr.ts          # parser cron 5 field + next run (WIB)
  stats.ts              # stats + audit
  cron.ts               # entry cron tiap menit
  preview.ts            # preview media + tombol download
  features/
    index.ts            # registry command/flow/callback
    tools.ts            # QR, cuaca, sholat, kurs, lirik, paste
    vault.ts            # simpan & kirim ulang file
    productivity.ts     # note, todo, reminder
    ai.ts               # chat, ringkas, translate, image, TTS, STT
    search.ts           # cari YouTube + inline mode
    monitor.ts          # RSS, uptime, crypto, GitHub
    admin.ts            # allow/deny/users/stats/audit/status/backup
  extract/
    index.ts            # deteksi platform
    youtube.ts          # Innertube ANDROID_VR + search
    tiktok.ts           # tikwm + scrape fallback
    instagram.ts        # web API → app API → embed
    facebook.ts         # plugin → embed → page
    terabox.ts          # direct API + cookie (pending)
    types.ts
scripts/
  set-webhook.mjs
  webhook-info.mjs
schema.sql
wrangler.jsonc
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

Salin `id` ke `wrangler.jsonc` bagian `kv_namespaces`.

### 2. Buat database D1

```powershell
npx wrangler d1 create bot-tele-db
```

Salin `database_id` ke `wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "bot-tele-db", "database_id": "<DATABASE_ID>" }
]
```

Terapkan skema:

```powershell
npx wrangler d1 execute bot-tele-db --remote --file=schema.sql
```

### 3. Binding AI

`wrangler.jsonc`:

```jsonc
"ai": { "binding": "AI" }
```

Tidak perlu API key.

### 4. Set secret

```powershell
"<BOT_TOKEN>"      | npx wrangler secret put BOT_TOKEN
"<WEBHOOK_SECRET>" | npx wrangler secret put WEBHOOK_SECRET
"<TERABOX_COOKIE>" | npx wrangler secret put TERABOX_COOKIE   # opsional
```

`WEBHOOK_SECRET` string acak 32 karakter (`[A-Za-z0-9_-]`). Dipakai untuk:

- path webhook `/tg/<secret>`
- header `X-Telegram-Bot-Api-Secret-Token`
- signing URL `/dl/<token>`
- path webhook GitHub `/gh/<secret>`

### 5. Deploy

```powershell
npx wrangler deploy
```

Cron `* * * * *` ikut terpasang otomatis.

### 6. Daftarkan webhook

```powershell
$env:BOT_TOKEN="<BOT_TOKEN>"
$env:WEBHOOK_SECRET="<WEBHOOK_SECRET>"
$env:PUBLIC_URL="https://bot-tele.awand795.workers.dev"
node scripts/set-webhook.mjs   # sudah termasuk inline_query
```

### 7. Aktifkan inline mode (sekali saja, manual)

Bot API tidak bisa mengaktifkan inline mode. Di **@BotFather**:

```
/setinline  → pilih bot → isi placeholder: "Cari video atau tempel link"
/setinlinefeedback → pilih bot → Enabled (opsional)
```

Setelah itu ketik `@adnawaa_bot <judul/link>` di chat mana pun.

---

## Development lokal

`.dev.vars` (jangan di-commit):

```
BOT_TOKEN=...
WEBHOOK_SECRET=...
```

```powershell
npx wrangler dev
npx tsc --noEmit
```

Untuk webhook saat development, pakai tunnel (cloudflared/ngrok) lalu daftarkan URL tunnel.

---

## Debug endpoint (butuh `WEBHOOK_SECRET`)

| Endpoint | Fungsi |
| --- | --- |
| `GET /health` | Cek Worker hidup |
| `GET /_debug?key=&url=` | Hasil ekstraksi tanpa kirim ke Telegram |
| `GET /_link?key=&url=&mode=audio` | Signed `/dl` URL untuk tes streaming |
| `GET /_send?key=&chat=&url=&mode=` | Tes kirim langsung ke chat |
| `GET /_chats?key=` | Daftar chat yang pernah `/start` |
| `GET /_probe?key=&url=` | Probe request keluar |
| `GET /_ai?key=&model=&prompt=` | Tes model Workers AI + ringkasan output |
| `GET /_cron?key=&job=feeds\|monitors\|alerts\|all` | Jalankan job cron manual |

Contoh:

```
/_debug?key=SECRET&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ
/_ai?key=SECRET&model=@cf/meta/llama-3.3-70b-instruct-fp8-fast&prompt=halo
```

---

## Kendala yang diketahui

### 1. TeraBox butuh cookie

TeraBox menolak request anonim dengan captcha (`verify_v2`). Alternatif pihak ketiga juga memblokir IP Worker. Supaya aktif, isi secret `TERABOX_COOKIE` dengan cookie akun TeraBox.

### 2. Instagram sering `429`

Instagram membatasi IP datacenter. Bot sudah mencoba web API, app API, dan embed; jika semuanya gagal, tampil pesan error.

### 3. TikTok `Free Api Limit: 1 request/second`

Fallback scrape `__UNIVERSAL_DATA_FOR_REHYDRATION__` sudah aktif, jadi video/foto/audio tetap bisa diambil.

### 4. YouTube hanya 360p

Free plan tidak memungkinkan remux/ffmpeg. Format muxed tanpa remux: **itag 18 (360p)**; audio: **itag 140 (M4A)**.

### 5. Model AI pernah deprecated

`@cf/meta/llama-3.1-8b-instruct` di-deprecate 30 Mei 2026. Kode sekarang memakai:

```
@cf/meta/llama-3.3-70b-instruct-fp8-fast
@cf/meta/llama-3.1-8b-instruct-fp8      (fallback)
@cf/meta/llama-3.2-3b-instruct         (fallback)
```

Jika Cloudflare mengganti model lagi, tes lewat `/_ai` lalu update `CHAT_MODELS` di `src/features/ai.ts`.

### 6. TTS mengirim WAV

MeloTTS menghasilkan WAV, sedangkan `sendAudio` Telegram hanya menerima MP3/M4A. Karena tidak ada ffmpeg di free plan, hasil TTS dikirim sebagai **dokumen WAV** (bisa diputar di kebanyakan client).

### 7. Feed RSS bisa timeout

Beberapa feed (mis. hnrss.org) kadang > 15 detik dari IP Worker. Item akan dicoba lagi pada siklus berikutnya.

### 8. Batas Cloudflare Workers Free

- CPU **10 ms/request** → tanpa remux/transcode.
- KV **1.000 write/hari** → state, cache, rate limit, dedupe.
- D1 free: 5 juta baris dibaca/hari, 100 ribu baris ditulis/hari.
- Cron minimum **1 menit**.

### 9. Batas Telegram

- URL fetch maksimal **20 MB**, multipart maksimal **50 MB** → threshold bot **45 MB**.
- `callback_data` maksimal 64 byte → file_id tidak dimasukkan ke callback (pakai ID vault).

### 10. Monitor 403 / Cloudflare `error code: 1003`

Cloudflare menolak request ke **alamat IP mentah** dengan `403 error code: 1003` (DNS/URL tidak diizinkan).
Bot otomatis mencoba ulang lewat `<ip>.nip.io` bila host masih berupa IP. Tetap disarankan memakai
**domain/hostname** asli, misalnya `http://94.237.69.119.nip.io:5173/`.

Status 🟡 **terproteksi** bukan berarti server mati: server membalas, tetapi meminta login atau diblokir
Cloudflare/WAF. Kalau ingin dianggap benar-benar online, monitor URL yang bisa diakses publik.

---

## Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| Bot diam | Webhook salah / secret beda | Cek `webhook-info.mjs`, lihat `last_error_message` |
| `401 Unauthorized` | `BOT_TOKEN` salah | Set ulang secret |
| `Database sedang tidak bisa diakses` | D1 binding salah / skema belum diterapkan | Cek `wrangler.jsonc`, jalankan `schema.sql` |
| AI error `deprecated` | Model dihapus Cloudflare | Tes `/_ai`, update `CHAT_MODELS` |
| AI error kuota | Batas 20/hari | Tunggu besok |
| `/img` error properti | Skema input model berubah | Tes `/_ai`, sesuaikan input |
| Video gagal terkirim | Telegram gagal fetch `/dl` | Tes `/_link`, pastikan Range `206` |
| `429` Instagram | Rate limit IP | Tunggu / pakai link lain |
| Alert harga tidak masuk | CoinGecko 429 | Fallback Binance otomatis; cek `/alert` |
| Monitor `down (403)` | IP mentah diblokir Cloudflare (`1003`) | Pakai `http://<ip>.nip.io:<port>/` atau domain asli |
| Inline tidak muncul | Inline mode belum aktif | `/setinline` di @BotFather |
| KV write habis | Batas 1.000/hari | Kurangi cache/state write |

---

## Roadmap

- [ ] Instagram: fallback GraphQL + pesan error lebih jelas
- [ ] TikTok: cache hasil per URL
- [ ] YouTube: opsi kualitas lain saat sudah pakai Paid plan
- [ ] Album/carousel: caption per item
- [ ] TeraBox: aktifkan setelah cookie tersedia
- [ ] Auto-backup harian ke chat owner
- [ ] Rotasi token Cloudflare & token bot

---

## Keamanan

- Token Cloudflare dan token bot **pernah terekspos di chat** → rotasi setelah bot stabil.
- Jangan commit `.dev.vars`, `.webhook-secret.local`, atau cookie apa pun.
- Repo ini **public** — kredensial hanya boleh disimpan sebagai **Worker secrets**.
- `.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`, `*.log`, `.env`, `.webhook-secret.local`.
- Bot default **owner-only**; user baru harus di-`/allow`.

---

## Lisensi

MIT
