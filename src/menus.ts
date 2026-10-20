import type { InlineKeyboardMarkup } from "./types";

export function mainMenu(): InlineKeyboardMarkup {
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
      [{ text: "❓ Bantuan", callback_data: "menu:help" }],
    ],
  };
}

export function backMenu(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]] };
}

export const START_TEXT =
  "<b>👋 Selamat datang!</b>\n\n" +
  "Saya bisa bantu mengambil file dan media dari:\n\n" +
  "📦 <b>TeraBox</b> — file & folder share link\n" +
  "📥 <b>Sosmed</b> — TikTok, Instagram, Facebook\n" +
  "🎵 <b>YouTube</b> — audio & video 360p\n" +
  "👀 <b>Story</b> — segera hadir\n\n" +
  "Kirim link langsung, atau pilih menu di bawah.";

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
  "Story Instagram/Facebook/TikTok butuh sesi login dan saat ini belum bisa dijalankan penuh di Cloudflare Worker. Nanti akan diaktifkan kalau sudah ada mesin pendukungnya.";

export const HELP_TEXT =
  "<b>❓ Bantuan</b>\n\n" +
  "<b>Command</b>\n" +
  "/start — menu utama\n" +
  "/help — bantuan\n" +
  "/id — lihat chat ID\n" +
  "/cancel — batalkan input\n\n" +
  "<b>Cara pakai</b>\n" +
  "1. Pilih menu (TeraBox / Sosmed / YouTube)\n" +
  "2. Kirim link\n" +
  "3. Klik tombol download\n\n" +
  "<b>Batas</b>\n" +
  "• File ≤ 20 MB dikirim otomatis\n" +
  "• File 20–45 MB diunggah bot\n" +
  "• File > 45 MB hanya link download\n" +
  "• 12 request per jam per user";

export function rateLimited(resetInMinutes: number): string {
  return (
    "⚠️ <b>Batas pemakaian tercapai</b>\n\n" +
    `Kamu sudah memakai 12 request pada jam ini.\n` +
    `Coba lagi dalam ±${resetInMinutes} menit.`
  );
}
