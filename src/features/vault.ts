import type { Ctx } from "./context";
import { qAll, qFirst, qRun } from "../db";
import { clip, editMessage, esc, sendByFileId, sendMessage } from "../telegram";
import { humanSize } from "../extract/types";
import type { Env } from "../env";

export interface VaultRow {
  id: number;
  user_id: number;
  file_id: string;
  file_unique_id: string | null;
  kind: "video" | "audio" | "photo" | "document" | "voice";
  name: string | null;
  size: number | null;
  mime: string | null;
  caption: string | null;
  created_at: number;
}

interface SaveItem {
  fileId: string;
  uniqueId: string;
  kind: VaultRow["kind"];
  name: string;
  size?: number;
  mime?: string;
  caption?: string;
}

function itemFromMessage(ctx: Ctx): SaveItem | null {
  const msg = ctx.msg;
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      uniqueId: msg.document.file_unique_id,
      kind: "document",
      name: msg.document.file_name ?? "dokumen",
      size: msg.document.file_size,
      mime: msg.document.mime_type,
      caption: msg.caption,
    };
  }
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      uniqueId: msg.video.file_unique_id,
      kind: "video",
      name: msg.video.file_name ?? `video-${msg.video.file_unique_id}.mp4`,
      size: msg.video.file_size,
      mime: msg.video.mime_type ?? "video/mp4",
      caption: msg.caption,
    };
  }
  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      uniqueId: msg.audio.file_unique_id,
      kind: "audio",
      name: msg.audio.file_name ?? `${msg.audio.title ?? "audio"}.mp3`,
      size: msg.audio.file_size,
      mime: msg.audio.mime_type ?? "audio/mpeg",
      caption: msg.caption,
    };
  }
  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      uniqueId: msg.voice.file_unique_id,
      kind: "voice",
      name: `voice-${msg.voice.file_unique_id}.ogg`,
      size: msg.voice.file_size,
      mime: msg.voice.mime_type ?? "audio/ogg",
      caption: msg.caption,
    };
  }
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      fileId: photo.file_id,
      uniqueId: photo.file_unique_id,
      kind: "photo",
      name: `photo-${photo.file_unique_id}.jpg`,
      size: photo.file_size,
      mime: "image/jpeg",
      caption: msg.caption,
    };
  }
  return null;
}

export async function saveIncoming(ctx: Ctx): Promise<boolean> {
  const item = itemFromMessage(ctx);
  if (!item) return false;

  const now = Date.now();
  await qRun(
    ctx.env,
    `INSERT INTO vault(user_id, file_id, file_unique_id, kind, name, size, mime, caption, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    ctx.userId,
    item.fileId,
    item.uniqueId,
    item.kind,
    item.name,
    item.size ?? null,
    item.mime ?? null,
    item.caption ?? null,
    now,
  );

  const row = await qFirst<{ id: number }>(
    ctx.env,
    "SELECT id FROM vault WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    ctx.userId,
  );

  const keyboard =
    item.kind === "voice"
      ? {
          inline_keyboard: [
            [{ text: "📝 Transkripsi", callback_data: `stt:${row?.id ?? 0}` }],
            [{ text: "🗂 Vault", callback_data: "menu:vault" }],
          ],
        }
      : { inline_keyboard: [[{ text: "🗂 Buka Vault", callback_data: "menu:vault" }]] };

  await sendMessage(
    ctx.env,
    ctx.chatId,
    `✅ <b>Tersimpan di Vault</b>\n\n` +
      `📄 ${esc(item.name)}\n` +
      `📦 ${humanSize(item.size)}\n` +
      `🆔 <code>#${row?.id ?? 0}</code> · ${item.kind}`,
    { keyboard },
  );
  return true;
}

function kindIcon(kind: string): string {
  if (kind === "video") return "🎬";
  if (kind === "audio" || kind === "voice") return "🎵";
  if (kind === "photo") return "🖼";
  return "📄";
}

export async function cmdVault(ctx: Ctx): Promise<void> {
  const rows = await qAll<VaultRow>(
    ctx.env,
    "SELECT * FROM vault WHERE user_id = ? ORDER BY id DESC LIMIT 10",
    ctx.userId,
  );
  if (!rows.length) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "🗂 <b>Vault kosong</b>\n\nKirim file/foto/video/voice ke bot, nanti otomatis tersimpan.\nFile tetap di server Telegram — bot hanya menyimpan index-nya.",
    );
    return;
  }

  const lines = ["🗂 <b>Vault kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`<b>#${row.id}</b> ${kindIcon(row.kind)} ${esc(clip(row.name ?? "file", 40))} — ${humanSize(row.size ?? undefined)}`);
    keyboard.push([
      { text: `📤 #${row.id}`, callback_data: `vault_send:${row.id}` },
      { text: `🗑 #${row.id}`, callback_data: `vault_del:${row.id}` },
    ]);
  }
  keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function sendVaultItem(env: Env, chatId: number, id: number, userId: number): Promise<boolean> {
  const row = await qFirst<VaultRow>(env, "SELECT * FROM vault WHERE id = ? AND user_id = ?", id, userId);
  if (!row) {
    await sendMessage(env, chatId, "❌ File tidak ditemukan di vault kamu.");
    return false;
  }
  try {
    await sendByFileId(env, chatId, row.kind, row.file_id, `🗂 <b>#${row.id}</b> ${esc(row.name ?? "file")}`);
    return true;
  } catch (err) {
    await sendMessage(env, chatId, `❌ Gagal mengirim file: ${esc((err as Error).message)}`);
    return false;
  }
}

export async function deleteVaultItem(
  env: Env,
  chatId: number,
  messageId: number,
  id: number,
  userId: number,
): Promise<boolean> {
  const row = await qFirst<VaultRow>(env, "SELECT * FROM vault WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return false;
  await qRun(env, "DELETE FROM vault WHERE id = ? AND user_id = ?", id, userId);
  await editMessage(env, chatId, messageId, `🗑 <b>#${id}</b> ${esc(row.name ?? "file")} dihapus dari vault.`, {
    keyboard: { inline_keyboard: [[{ text: "🗂 Kembali ke Vault", callback_data: "menu:vault" }]] },
  });
  return true;
}
