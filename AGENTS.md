# AGENTS.md — Deploy, kredensial, dan handoff

Dokumen ini untuk AI agent / developer berikutnya yang melanjutkan proyek ini.
Bacalah bagian **Aturan wajib** dan **Kredensial** sebelum menjalankan perintah.

## Ringkasan proyek

- Bot Telegram pribadi, **100% Cloudflare Workers free plan** — tanpa VPS, tanpa server sendiri.
- Worker: `https://bot-tele.awand795.workers.dev`
- Bot: `@adnawaa_bot`
- Repo: `https://github.com/awand795/bot-tele`
- Owner chat ID: ada di `.env` (`OWNER_CHAT_ID`).
- Bahasa bot dan dokumentasi: **Indonesia**.
- Jangan menampilkan kata "Cloudflare Worker" di teks yang dilihat user bot.

## Aturan wajib

1. **Jangan commit `.env`.** File itu sudah masuk `.gitignore` dan berisi kredensial asli.
2. **Jangan pernah mencetak / mengirim isi secret ke chat, log, issue, atau commit.**
3. Jangan menambahkan VPS, database eksternal, atau layanan berbayar. Tetap di free plan.
4. Jangan mengubah cron trigger di `wrangler.jsonc` dari `* * * * *`. Jadwal per item disimpan di D1.
5. Jangan mengirim halaman error HTML/JSON sebagai media. Guard `MediaFetchError` dan `isMediaContentType` harus dipertahankan.
6. Perubahan UI bot memakai bahasa Indonesia; jangan menyebut infrastruktur Cloudflare ke user.
7. Setelah mengubah kode: `npm run typecheck`, deploy, lalu tes minimal `/health` dan `/_link`.

## Kredensial dan environment

| File | Status | Isi |
| --- | --- | --- |
| `.env` | **gitignored, private** | Nilai aktual untuk deploy dan testing lokal |
| `.env.example` | tracked | Template tanpa secret |
| `scripts/load-env.ps1` | tracked | Memuat `.env` ke sesi PowerShell |
| `scripts/set-secrets.ps1` | tracked | Push nilai `.env` ke Worker secrets |
| `wrangler.jsonc` | tracked | Nama Worker, ID KV/D1, binding AI, cron |

Cek bahwa `.env` benar-benar diabaikan:

```powershell
git check-ignore -v .env
```

### Variabel di `.env`

| Variabel | Kegunaan | Catatan |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy`, D1/KV | Hanya untuk CLI, bukan Worker secret |
| `CLOUDFLARE_ACCOUNT_ID` | Akun Cloudflare | Hanya untuk CLI |
| `BOT_TOKEN` | Telegram Bot API | Worker secret + dipakai `set-webhook.mjs` |
| `WEBHOOK_SECRET` | Path webhook, HMAC `/dl`, GitHub webhook | Worker secret |
| `PUBLIC_URL` | URL Worker publik | Dipakai `set-webhook.mjs` |
| `OWNER_CHAT_ID` | Chat owner untuk tes `/_send` | Bukan rahasia |
| `D1_DATABASE_NAME` / `D1_DATABASE_ID` | Referensi D1 | Nilai asli ada di `wrangler.jsonc` |
| `KV_NAMESPACE_ID` | Referensi KV | Nilai asli ada di `wrangler.jsonc` |
| `TERABOX_COOKIE` | Download TeraBox | Opsional; saat ini kosong |
| `INSTAGRAM_COOKIE` | Instagram web/app API | Sudah diset sebagai Worker secret; nilainya tidak disimpan di `.env` |
| `TIKTOK_COOKIE` | CDN TikTok + API | Sudah diset sebagai Worker secret dan ada di `.env` |

> Cookie platform memberi **akses penuh ke akun**. Gunakan akun cadangan. Rotasi setelah testing.

### Worker secrets vs `.env`

`.env` hanya untuk environment lokal/CLI. Worker **tidak membaca `.env`**.
Secret Worker harus diset terpisah:

```powershell
.\scripts\set-secrets.ps1
```

Script itu membaca `.env` dan mengirim `BOT_TOKEN`, `WEBHOOK_SECRET`, `TERABOX_COOKIE`,
`INSTAGRAM_COOKIE`, dan `TIKTOK_COOKIE` yang tidak kosong. Nilai kosong dilewati agar
secret lama tidak terhapus.

Cek nama secret yang sudah ada (nilai tidak bisa dibaca):

```powershell
npx wrangler secret list
```

## Deploy cepat

```powershell
. .\scripts\load-env.ps1
npm install
npm run typecheck
npx wrangler deploy
node scripts/set-webhook.mjs
```

`set-webhook.mjs` membaca `BOT_TOKEN`, `WEBHOOK_SECRET`, dan `PUBLIC_URL` dari environment.
Jika webhook gagal, cek `last_error_message` lewat `scripts/webhook-info.mjs`.

Deploy pertama kali / akun baru:

1. Buat KV: `npx wrangler kv namespace create BOT_KV`, salin ID ke `wrangler.jsonc`.
2. Buat D1: `npx wrangler d1 create bot-tele-db`, salin ID ke `wrangler.jsonc`.
3. Terapkan skema: `npx wrangler d1 execute bot-tele-db --remote --file=schema.sql`.
4. Set secret: `.\scripts\set-secrets.ps1`.
5. Deploy dan daftarkan webhook seperti di atas.

## Set / rotasi secret

```powershell
. .\scripts\load-env.ps1
.\scripts\set-secrets.ps1
npx wrangler secret list
```

Contoh set satu secret manual:

```powershell
$env:BOT_TOKEN | npx wrangler secret put BOT_TOKEN
$env:WEBHOOK_SECRET | npx wrangler secret put WEBHOOK_SECRET
$env:TIKTOK_COOKIE | npx wrangler secret put TIKTOK_COOKIE
```

### Rotasi yang masih tertunda

Token berikut pernah terekspos di chat dan **harus dirotasi** setelah bot stabil:

1. `BOT_TOKEN` — revoke lewat @BotFather, update `.env`, jalankan `set-secrets`, lalu `set-webhook`.
2. `CLOUDFLARE_API_TOKEN` — buat token baru di dashboard, update `.env`.
3. `INSTAGRAM_COOKIE` — logout sesi lama / ganti password, ambil cookie baru, isi `.env`, lalu jalankan `set-secrets`.
4. `WEBHOOK_SECRET` — buat string acak 32 karakter, update `.env`, `set-secrets`, dan `set-webhook`.
5. `TIKTOK_COOKIE` — logout / rotasi sesi, update `.env`, lalu `set-secrets`.

Cara mengambil cookie: browser yang sudah login → DevTools → Network → pilih request →
Request Headers → copy nilai `cookie`. Simpan sebagai **satu baris**, jangan decode `%3A`.

## Test cepat

```powershell
. .\scripts\load-env.ps1
$base = $env:PUBLIC_URL
$key = $env:WEBHOOK_SECRET

Invoke-RestMethod "$base/health"

# Ekstraksi saja
$url = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
Invoke-RestMethod "$base/_link?key=$key&url=$([uri]::EscapeDataString($url))"

# Kirim ke owner
Invoke-RestMethod "$base/_send?key=$key&chat=$($env:OWNER_CHAT_ID)&url=$([uri]::EscapeDataString($url))"
```

Yang diharapkan untuk TikTok:

- `/_link` → `kind: "video"`, `filename: "tiktok_....mp4"`, `size` terisi.
- `/dl/<token>` → `HTTP 206`, `Content-Type: video/mp4`.
- `/_send` → `ok: true`, `mode: "url"` (≤20 MB) atau `mode: "upload"`.

Contoh Instagram:

```text
https://www.instagram.com/reel/DNBCJoiOp9J/
```

Tanpa cookie Instagram, hasil bisa `429`/`403`. Dengan cookie, `/_link` harus
menghasilkan `video/mp4` dan `/_send` mengirim media.

## Arsitektur singkat

```text
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

File penting:

| File | Fungsi |
| --- | --- |
| `src/index.ts` | HTTP router: `/tg`, `/dl`, `/p`, `/gh`, `/health`, debug |
| `src/router.ts` | Dispatch update, menu, callback, flow TeraBox |
| `src/sender.ts` | Strategi kirim: URL → upload → link |
| `src/resolve.ts` | Payload → stream upstream, guard content-type |
| `src/crypto.ts` | HMAC signed URL |
| `src/extract/tiktok.ts` | TikWM, proxy, web API, mobile page, validasi media |
| `src/extract/instagram.ts` | Shortcode → media ID, cookie, web/app API, embed |
| `src/cron.ts` | Entry cron tiap menit |
| `schema.sql` | Skema D1 |
| `wrangler.jsonc` | Binding KV/D1/AI + cron |

## Status fitur dan kendala

| Fitur | Status | Catatan |
| --- | --- | --- |
| YouTube | ✅ | Hanya 360p muxed; audio M4A |
| TikTok | ✅ | TikWM + proxy + mobile page; cookie CDN; rate limit sesekali |
| Instagram | ⚠️ | Butuh cookie; rotasi cookie yang terekspos |
| Facebook | ✅ | Plugin embed + regex halaman |
| TeraBox | ⏸️ | Butuh `TERABOX_COOKIE` |
| Inline mode | ⚠️ | `/setinline` harus diaktifkan manual di @BotFather |
| Vault/STT | ⚠️ | Kode ada, pengiriman visual belum dikonfirmasi penuh |
| AI | ✅ | Workers AI, 20 request/user/hari |

### Catatan TikTok

Urutan provider saat ini:

1. TikWM langsung.
2. TikWM lewat proxy Google Translate (`www-tikwm-com.translate.goog` dan `tikwm-com.translate.goog`).
3. Web API `item/detail`.
4. Scrape halaman dengan **User-Agent mobile**.

Halaman TikTok dengan UA desktop + cookie sering `403`; UA mobile tanpa cookie lebih stabil.
Cookie hanya dikirim ke host TikTok (`*.tiktok.com` / `*.tiktokv.com`), bukan ke TikWM/proxy.
Setiap kandidat media divalidasi dengan request `Range: bytes=0-0`; jika 403/HTML, kandidat
berikutnya dicoba. Ini mencegah video putih / halaman error terkirim.

Jika TikTok masih gagal, cek `npx wrangler tail` untuk pesan `tiktok attempt failed`.
Rate limit TikWM/Google bisa pulih setelah beberapa saat; minta user mencoba lagi.

## Checklist handoff

- [ ] `.env` ada, terisi, dan `git check-ignore -v .env` menunjukkan `.gitignore`.
- [ ] `npm run typecheck` bersih.
- [ ] `npx wrangler deploy` sukses.
- [ ] `npx wrangler secret list` memuat `BOT_TOKEN`, `WEBHOOK_SECRET`, `TIKTOK_COOKIE` (dan `INSTAGRAM_COOKIE` jika dipakai).
- [ ] `node scripts/set-webhook.mjs` sukses.
- [ ] `/health`, `/_link`, dan `/_send` TikTok berhasil.
- [ ] Rotasi token/cookie yang terekspos.
- [ ] `git status` bersih setelah commit; `.env` tidak pernah masuk commit.
