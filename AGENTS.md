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
| `YOUTUBE_COOKIE` | Bypass bot-check YouTube | Opsional; isi lewat `.env` lalu `set-secrets` |

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
Browser  ──GET /m/<token>──► halaman gabung video+audio YouTube (remux di browser user)
GitHub   ──POST /gh/<secret>──► verifikasi HMAC ──► notifikasi ke chat
Cron     ──* * * * *──► reminder · uptime · RSS · alert
```

File penting:

| File | Fungsi |
| --- | --- |
| `src/index.ts` | HTTP router: `/tg`, `/dl`, `/p`, `/m`, `/gh`, `/health`, debug |
| `src/router.ts` | Dispatch update, menu, callback, flow TeraBox |
| `src/sender.ts` | Strategi kirim: URL → upload → link |
| `src/resolve.ts` | Payload → stream upstream, guard content-type |
| `src/crypto.ts` | HMAC signed URL (`verifyPayload` harus tetap menolak token rusak tanpa throw) |
| `src/web/mux-page.ts` | Halaman HTML gabung video + audio |
| `src/web/mux-client.txt` | Penggabung fMP4 yang jalan di browser (di-import sebagai teks) |
| `src/extract/tiktok.ts` | TikWM, proxy, web API, mobile page, validasi media |
| `src/extract/instagram.ts` | Shortcode → media ID, cookie, web/app API, embed |
| `src/cron.ts` | Entry cron tiap menit |
| `schema.sql` | Skema D1 |
| `wrangler.jsonc` | Binding KV/D1/AI + cron |

## Status fitur dan kendala

| Fitur | Status | Catatan |
| --- | --- | --- |
| YouTube | ✅ | 360p muxed (bersuara); 720p/1080p video-only; HD + suara lewat halaman `/m` |
| TikTok | ✅ | TikWM + proxy + mobile page; cookie CDN; rate limit sesekali |
| Instagram | ⚠️ | Butuh cookie; rotasi cookie yang terekspos |
| Facebook | ✅ | Plugin embed + regex halaman |
| TeraBox | ⏸️ | Butuh `TERABOX_COOKIE` |
| Inline mode | ⚠️ | `/setinline` harus diaktifkan manual di @BotFather |
| Vault/STT | ⚠️ | Kode ada, pengiriman visual belum dikonfirmasi penuh |
| AI | ✅ | Workers AI, 20 request/user/hari |

### Catatan YouTube

Client yang dipakai bot (`ANDROID_VR`) hanya memberi satu format **muxed** (video+audio
jadi satu), yaitu itag 18 / 360p. Stream 720p dan 1080p hanya tersedia sebagai
**adaptive video-only** (tanpa audio). Anggapan ini sudah diverifikasi lewat probe ke
client IOS, ANDROID, ANDROID_TESTSUITE, MWEB, dan WEB_EMBEDDED_PLAYER.

Bot memilih varian H.264 (`avc1`) per resolusi supaya bisa diputar di semua client
Telegram. 1080p biasanya >45 MB sehingga jatuh ke mode link; 720p sering masih
bisa diunggah. Jangan menambahkan transcode/mux di Worker: CPU limit free plan
10 ms dan memori 128 MB.

Supaya HD tetap bersuara, tombol 🔊 di preview mengarah ke `/m/<token>`: halaman HTML
mandiri yang mengunduh stream video + audio lewat `/dl`, lalu menggabungkannya menjadi
satu MP4 **di browser user** (`src/web/mux-client.txt`), tanpa proses media di Worker.
Penggabung itu tidak men-decode/meng-encode; ia menyalin `trak` video, menambah `trak`
audio sebagai track 2, lalu menyelang-seling fragment `moof/mdat` berdasarkan `tfdt`.
Konsekuensinya: hasil masuk folder Download user (bukan ke chat), 1080p berat di HP,
dan link halaman memakai TTL `LINK_TTL` (2 jam).

Kalau menyentuh `src/web/mux-client.txt`, uji dengan ffmpeg/ffprobe lokal: hasil harus
mempunyai dua stream (h264 + aac) dan lolos `ffmpeg -v error -i hasil.mp4 -f null -`.
Jangan menambah field payload `/m` tanpa menyesuaikan `renderMuxPage`.

#### Bot-check YouTube

Sejak akhir 2026 YouTube sering membalas `LOGIN_REQUIRED` ("Sign in to confirm you're
not a bot") untuk IP datacenter termasuk Cloudflare, pada semua client. Urutan yang
dipakai `getYtInfo`:

1. Client `ANDROID_VR` — satu-satunya yang masih memberi format muxed 360p bersuara.
2. Client `IOS` — cadangan; sering hanya mengembalikan audio, jadi hanya diterima
   kalau ada format video dengan URL langsung.
3. Scrape `ytInitialPlayerResponse` lewat `www-youtube-com.translate.goog`.

Jalur 3 membuat permintaan player datang dari IP Google sehingga lolos bot-check, dan
parameter `ip=` pada URL media berisi IP peminta (Worker) — jadi `/dl` tetap bisa
streaming dari Worker. Konsekuensinya jalur 3 hanya memberi format adaptive: tidak ada
360p bersuara. `extractYouTube` lalu memakai video adaptive terdekat 360p sebagai media
utama dengan tanda `silent: true`, dan preview menampilkan tombol 🔊 ke halaman gabung.

Catatan operasional:

- `getYtInfo` mengabaikan cache KV yang tidak punya `video` maupun `videoOnly`, supaya
  entri lama (audio-only) tidak membuat `medias` kosong.
- `/_link` dan `/_send` mengembalikan JSON error bila `medias` kosong; jangan hapus guard
  ini, sebelumnya gejalanya `Cannot read properties of undefined (reading 'yt')`.
- Halaman translate ±1,4 MB per video; tetap di bawah CPU limit, tapi jangan menambah
  parsing berat di jalur ini.
- Kalau semua jalur gagal, bot membalas "YouTube membatasi permintaan dari server ini".
  Uji ulang beberapa saat kemudian, jangan langsung mengubah kode.
- Jalur 3 hanya best-effort: sebagian video mengembalikan `signatureCipher` (tanpa
  `url`) yang tidak bisa dipakai tanpa menjalankan JS player, jadi jangan diandalkan
  sebagai satu-satunya sumber.
- Perbaikan yang reliabel: set `YOUTUBE_COOKIE` (cookie akun YouTube dari browser yang
  sudah login) lewat `.env` + `set-secrets`. Cookie membuat client innertube lolos
  bot-check. Tanpa cookie, kemampuan YouTube bergantung IP Worker dan bisa hilang
  sewaktu-waktu.

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
