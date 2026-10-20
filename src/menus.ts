import type { InlineKeyboardMarkup } from "./types";

export function mainMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "⬇️ Download", callback_data: "menu:download" },
        { text: "🧰 Tools", callback_data: "menu:tools" },
      ],
      [
        { text: "🗂 Vault", callback_data: "menu:vault" },
        { text: "🤖 AI", callback_data: "menu:ai" },
      ],
      [
        { text: "📡 Monitor", callback_data: "menu:monitor" },
        { text: "⚙️ Setting", callback_data: "menu:setting" },
      ],
      [{ text: "❓ Bantuan", callback_data: "menu:help" }],
    ],
  };
}

export function backMenu(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]] };
}

export function downloadMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📦 TeraBox", callback_data: "menu:terabox" },
        { text: "📥 Sosmed", callback_data: "menu:sosmed" },
      ],
      [
        { text: "🎵 YouTube", callback_data: "menu:youtube" },
        { text: "👀 Story", callback_data: "menu:story" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
    ],
  };
}

export function toolsMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🔳 QR", callback_data: "flow:qr" },
        { text: "🌤 Cuaca", callback_data: "flow:weather" },
      ],
      [
        { text: "🕌 Sholat", callback_data: "flow:prayer" },
        { text: "💱 Kurs", callback_data: "flow:currency" },
      ],
      [
        { text: "🎵 Lirik", callback_data: "flow:lyrics" },
        { text: "📋 Paste", callback_data: "flow:paste" },
      ],
      [
        { text: "🔍 Cari YouTube", callback_data: "flow:cari" },
        { text: "⬅️ Kembali", callback_data: "menu:home" },
      ],
    ],
  };
}

export function vaultMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🗂 Daftar File", callback_data: "menu:vault_files" },
        { text: "📝 Catatan", callback_data: "menu:notes" },
      ],
      [
        { text: "✅ Todo", callback_data: "menu:todos" },
        { text: "⏰ Pengingat", callback_data: "menu:reminders" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
    ],
  };
}

export function aiMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "💬 Chat", callback_data: "flow:ai" },
        { text: "🧾 Ringkas", callback_data: "flow:ringkas" },
      ],
      [
        { text: "🌐 Terjemah", callback_data: "flow:tr" },
        { text: "🎨 Gambar", callback_data: "flow:img" },
      ],
      [
        { text: "🔊 TTS", callback_data: "flow:tts" },
        { text: "📝 STT", callback_data: "menu:stt_info" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
    ],
  };
}

export function monitorMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📡 RSS", callback_data: "menu:rss" },
        { text: "📈 Uptime", callback_data: "menu:uptime" },
      ],
      [
        { text: "🔔 Harga", callback_data: "menu:alert" },
        { text: "🐙 GitHub", callback_data: "menu:github" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "menu:home" }],
    ],
  };
}

export function settingMenu(isOwner: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [
    [
      { text: "⚙️ Status", callback_data: "menu:status" },
      { text: "🆔 Profil", callback_data: "menu:profile" },
    ],
    [{ text: "💾 Backup", callback_data: "menu:backup" }],
  ];
  if (isOwner) {
    rows.push([
      { text: "👥 Users", callback_data: "menu:users" },
      { text: "📊 Statistik", callback_data: "menu:stats" },
    ]);
    rows.push([{ text: "⏱ Cron", callback_data: "menu:cron" }]);
  }
  rows.push([{ text: "⬅️ Kembali", callback_data: "menu:home" }]);
  return { inline_keyboard: rows };
}

export const START_TEXT =
  "<b>👋 Selamat datang di Adnawaa Private Bot</b>\n\n" +
  "Asisten pribadi serba bisa dalam satu bot.\n\n" +
  "⬇️ <b>Download</b> — TeraBox, TikTok, Instagram, Facebook, YouTube\n" +
  "🧰 <b>Tools</b> — QR, cuaca, jadwal sholat, kurs, lirik, paste\n" +
  "🗂 <b>Vault</b> — simpan file, catatan, todo, pengingat\n" +
  "🤖 <b>AI</b> — chat, ringkas, terjemah, gambar, TTS, STT\n" +
  "📡 <b>Monitor</b> — RSS, uptime, alert harga, notifikasi GitHub\n" +
  "⚙️ <b>Setting</b> — status, profil, backup, admin\n\n" +
  "Kirim link langsung untuk download, atau pilih menu di bawah.";

export const HELP_TEXT =
  "<b>❓ Bantuan</b>\n\n" +
  "<b>Download</b>\n" +
  "/terabox — TeraBox\n" +
  "/sosmed — TikTok / Instagram / Facebook\n" +
  "/youtube — YouTube audio &amp; video\n\n" +
  "<b>Tools</b>\n" +
  "/qr &lt;teks&gt; · /cuaca &lt;kota&gt; · /sholat &lt;kota&gt;\n" +
  "/kurs USD · /lirik &lt;lagu&gt; · /paste &lt;teks&gt; · /get &lt;slug&gt;\n" +
  "/cari &lt;judul video&gt;\n\n" +
  "<b>Vault &amp; produktivitas</b>\n" +
  "Kirim file/foto/video/voice → otomatis masuk vault\n" +
  "/vault · /note · /notes · /todo · /todos\n" +
  "/remind 07:30 sarapan · /reminders\n\n" +
  "<b>AI</b> (kuota 20/hari)\n" +
  "/ai &lt;pertanyaan&gt; · /ringkas &lt;url|teks&gt;\n" +
  "/tr en &lt;teks&gt; · /img &lt;prompt&gt; · /tts &lt;teks&gt;\n" +
  "/stt (reply voice note)\n\n" +
  "<b>Monitor</b>\n" +
  "/rss add &lt;url&gt; [menit] · /monitor add &lt;url&gt; [menit]\n" +
  "/alert BTC &gt; 100000 [menit] · /gh owner/repo\n" +
  "/monitor test|every|pause|resume · /rss every · /alert every\n" +
  "/cron (owner) — lihat &amp; atur interval default\n\n" +
  "<b>Admin (owner)</b>\n" +
  "/allow &lt;id&gt; · /deny &lt;id&gt; · /users\n" +
  "/stats · /audit · /status · /backup\n\n" +
  "<b>Batas</b>\n" +
  "• File ≤ 20 MB dikirim otomatis\n" +
  "• File 20–45 MB diunggah bot\n" +
  "• File &gt; 45 MB hanya link download\n" +
  "• 12 download per jam per user";

export const TERABOX_PROMPT =
  "<b>📦 TeraBox</b>\n\n" +
  "Kirim link share TeraBox, contoh:\n" +
  "<code>https://terabox.com/s/1AbCdEfGhIjK</code>\n\n" +
  "Kalau link butuh password, sertakan juga:\n" +
  "<code>...?pwd=1234</code>\n\n" +
  "Saya akan tampilkan isi folder beserta tombol download.";

export const SOSMED_PROMPT =
  "<b>📥 Sosmed</b>\n\n" +
  "Kirim link dari salah satu platform:\n\n" +
  "• TikTok — video / foto / audio\n" +
  "• Instagram — post / reel / carousel\n" +
  "• Facebook — video / reel publik\n\n" +
  "Contoh: <code>https://www.tiktok.com/@user/video/123</code>";

export const YOUTUBE_PROMPT =
  "<b>🎵 YouTube</b>\n\n" +
  "Kirim link video YouTube, contoh:\n" +
  "<code>https://youtu.be/dQw4w9WgXcQ</code>\n\n" +
  "Tersedia:\n" +
  "• 🎬 Video 360p (dengan suara)\n" +
  "• 🎵 Audio M4A\n\n" +
  "<i>Catatan: batas upload Telegram 45 MB.</i>";

export const STORY_TEXT =
  "<b>👀 Story</b>\n\n" +
  "Fitur ini sedang disiapkan.\n\n" +
  "Story Instagram/Facebook/TikTok butuh sesi login dan saat ini belum bisa dijalankan penuh.";

export const TOOLS_TEXT =
  "<b>🧰 Tools</b>\n\n" +
  "Pilih tool di bawah, atau ketik command:\n\n" +
  "🔳 <code>/qr teks</code> — QR code\n" +
  "🌤 <code>/cuaca Jakarta</code> — cuaca 3 hari\n" +
  "🕌 <code>/sholat Bandung</code> — jadwal sholat\n" +
  "💱 <code>/kurs USD</code> — kurs hari ini\n" +
  "🎵 <code>/lirik judul lagu</code> — lirik\n" +
  "📋 <code>/paste teks</code> — paste publik 30 hari\n" +
  "🔍 <code>/cari lofi</code> — cari video YouTube";

export const VAULT_TEXT =
  "<b>🗂 Vault</b>\n\n" +
  "File yang kamu kirim ke bot disimpan sebagai index di database.\n" +
  "<i>File aslinya tetap di server Telegram — bot hanya menyimpan file_id.</i>\n\n" +
  "📥 Kirim dokumen / video / audio / foto / voice → otomatis masuk vault\n" +
  "/vault — daftar file\n" +
  "/note &lt;teks&gt; — catatan\n" +
  "/todo &lt;teks&gt; — daftar tugas\n" +
  "/remind 07:30 sarapan — pengingat WIB";

export const AI_TEXT =
  "<b>🤖 AI</b>\n\n" +
  "Ditenagai AI bawaan bot (tanpa API key eksternal).\n\n" +
  "💬 <code>/ai jelaskan quantum computing</code>\n" +
  "🧾 <code>/ringkas https://url-artikel</code>\n" +
  "🌐 <code>/tr en selamat pagi</code>\n" +
  "🎨 <code>/img kucing astronot</code>\n" +
  "🔊 <code>/tts halo semuanya</code>\n" +
  "📝 reply voice note dengan <code>/stt</code>\n\n" +
  "<i>Kuota 20 request/hari per user. Chat punya konteks 5 pesan terakhir.</i>";

export const MONITOR_TEXT =
  "<b>📡 Monitor</b>\n\n" +
  "📰 <b>RSS</b> — <code>/rss add https://hnrss.org/frontpage</code>\n" +
  "📈 <b>Uptime</b> — <code>/monitor add https://example.com</code>\n" +
  "🔔 <b>Harga</b> — <code>/alert BTC &gt; 100000</code>\n" +
  "🐙 <b>GitHub</b> — <code>/gh owner/repo</code>\n\n" +
  "⏱ <b>Interval bisa diatur</b> per item:\n" +
  "<code>/monitor add &lt;url&gt; 10</code> · <code>/rss every &lt;id&gt; 30</code>\n" +
  "<code>/alert every &lt;id&gt; 15</code> · <code>/monitor every &lt;id&gt; 5</code>\n\n" +
  "Buka daftar monitor → klik item untuk cek sekarang, ubah interval, jeda, atau hapus.\n\n" +
  "<i>Default: RSS 10m, uptime 5m, harga 15m. Owner bisa ubah lewat /cron.</i>\n" +
  "<i>Status 🟡 = server merespons tapi akses dibatasi (401/403/429).</i>";

export const SETTING_TEXT =
  "<b>⚙️ Setting</b>\n\n" +
  "🆔 <code>/id</code> — lihat ID kamu\n" +
  "⚙️ <code>/status</code> — status sistem\n" +
  "💾 <code>/backup</code> — backup data ke JSON\n\n" +
  "<b>Owner</b>\n" +
  "/allow &lt;id&gt; · /deny &lt;id&gt; · /users\n" +
  "/stats · /audit · /gh owner/repo\n" +
  "/cron · /cron set monitor|rss|alert &lt;menit&gt;";

export function rateLimited(resetInMinutes: number): string {
  return (
    "⚠️ <b>Batas pemakaian tercapai</b>\n\n" +
    `Kamu sudah memakai 12 request pada jam ini.\n` +
    `Coba lagi dalam ±${resetInMinutes} menit.`
  );
}
