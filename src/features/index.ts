import type { Ctx } from "./context";
import type { Env } from "../env";
import type { Action, Flow } from "../state";
import { clearState, setState } from "../state";
import type { TgCallbackQuery } from "../types";
import { bump } from "../stats";
import { backMenu } from "../menus";
import { editMessage, sendMessage } from "../telegram";
import { qRun } from "../db";
import * as tools from "./tools";
import * as vault from "./vault";
import * as productivity from "./productivity";
import * as ai from "./ai";
import * as search from "./search";
import * as monitor from "./monitor";
import * as admin from "./admin";

type Handler = (ctx: Ctx) => Promise<void>;

const COMMANDS: Record<string, Handler> = {
  qr: tools.cmdQr,
  cuaca: tools.cmdWeather,
  sholat: tools.cmdPrayer,
  kurs: tools.cmdCurrency,
  lirik: tools.cmdLyrics,
  paste: tools.cmdPaste,
  get: tools.cmdGetPaste,

  note: productivity.cmdNote,
  notes: productivity.cmdNotes,
  todo: productivity.cmdTodo,
  todos: productivity.cmdTodos,
  remind: productivity.cmdRemind,
  reminders: productivity.cmdReminders,

  vault: vault.cmdVault,
  files: vault.cmdVault,

  ai: ai.cmdAi,
  ringkas: ai.cmdSummarize,
  tr: ai.cmdTranslate,
  translate: ai.cmdTranslate,
  img: ai.cmdImage,
  gambar: ai.cmdImage,
  tts: ai.cmdTts,
  stt: ai.cmdStt,

  cari: search.cmdSearch,
  search: search.cmdSearch,

  rss: monitor.cmdRss,
  monitor: monitor.cmdMonitor,
  alert: monitor.cmdAlert,

  gh: admin.cmdGh,
  cron: admin.cmdCron,
  allow: admin.cmdAllow,
  deny: admin.cmdDeny,
  users: admin.cmdUsers,
  stats: admin.cmdStats,
  audit: admin.cmdAudit,
  status: admin.cmdStatus,
  backup: admin.cmdBackup,
};

export async function dispatchCommand(ctx: Ctx, raw: string): Promise<boolean> {
  const name = raw.trim().split(/\s+/)[0].replace(/^\//, "").split("@")[0].toLowerCase();
  const handler = COMMANDS[name];
  if (!handler) return false;
  try {
    await handler(ctx);
    await bump(ctx.env, `cmd:${name}`);
  } catch (err) {
    console.error(`command ${name} failed`, err);
    await sendMessage(ctx.env, ctx.chatId, `❌ ${(err as Error).message}`).catch(() => undefined);
  }
  return true;
}

export async function dispatchMedia(ctx: Ctx): Promise<boolean> {
  try {
    const saved = await vault.saveIncoming(ctx);
    if (saved) await bump(ctx.env, "vault:save");
    return saved;
  } catch (err) {
    await sendMessage(ctx.env, ctx.chatId, `❌ Gagal menyimpan ke vault: ${(err as Error).message}`);
    return true;
  }
}

/* --------------------------- guided input flows --------------------------- */

const PROMPTS: Record<string, { flow: Flow; text: string }> = {
  qr: { flow: "qr", text: "🔳 Kirim teks atau link yang mau dijadikan QR code." },
  weather: { flow: "weather", text: "🌤 Kirim nama kota, contoh: <code>Jakarta</code>" },
  prayer: { flow: "prayer", text: "🕌 Kirim nama kota untuk jadwal sholat." },
  currency: { flow: "currency", text: "💱 Kirim kode mata uang, contoh: <code>USD</code> atau <code>100 USD IDR</code>" },
  lyrics: { flow: "lyrics", text: "🎵 Kirim judul lagu, contoh: <code>perfect ed sheeran</code>" },
  paste: { flow: "paste", text: "📋 Kirim teks yang mau dijadikan paste publik." },
  cari: { flow: "cari", text: "🔍 Kirim judul video yang mau dicari di YouTube." },
  ai: { flow: "ai", text: "🤖 Kirim pertanyaan untuk AI." },
  ringkas: { flow: "ringkas", text: "🧾 Kirim URL artikel atau teks panjang yang mau diringkas." },
  tr: { flow: "tr", text: "🌐 Kirim teks yang mau diterjemahkan.\nBisa juga: <code>en selamat pagi</code>" },
  img: { flow: "img", text: "🎨 Kirim deskripsi gambar yang mau dibuat." },
  tts: { flow: "tts", text: "🔊 Kirim teks yang mau diubah jadi suara." },
};

export async function dispatchFlow(ctx: Ctx, flow: Flow): Promise<boolean> {
  const text = ctx.text.trim();
  const withText: Ctx = { ...ctx, args: text.split(/\s+/).filter(Boolean) };
  try {
    switch (flow) {
      case "qr":
        await tools.cmdQr({ ...ctx, args: [text] });
        break;
      case "weather":
        await tools.cmdWeather({ ...ctx, args: [text] });
        break;
      case "prayer":
        await tools.cmdPrayer({ ...ctx, args: [text] });
        break;
      case "currency":
        await tools.cmdCurrency(withText);
        break;
      case "lyrics":
        await tools.cmdLyrics({ ...ctx, args: [text] });
        break;
      case "paste":
        await tools.cmdPaste({ ...ctx, args: [text] });
        break;
      case "cari":
        await search.cmdSearch({ ...ctx, args: [text] });
        break;
      case "ai":
        await ai.cmdAi({ ...ctx, args: [text] });
        break;
      case "ringkas":
        await ai.cmdSummarize({ ...ctx, args: [text] });
        break;
      case "tr":
        await ai.cmdTranslate(withText);
        break;
      case "img":
        await ai.cmdImage({ ...ctx, args: [text] });
        break;
      case "tts":
        await ai.cmdTts({ ...ctx, args: [text] });
        break;
      case "rss":
        await monitor.addRss(ctx.env, ctx.userId, ctx.chatId, text);
        break;
      case "monitor":
        await monitor.addMonitor(ctx.env, ctx.userId, ctx.chatId, text);
        break;
      case "alert":
        await monitor.cmdAlert(withText);
        break;
      case "note":
        await productivity.cmdNote({ ...ctx, args: [text] });
        break;
      case "todo":
        await productivity.cmdTodo({ ...ctx, args: [text] });
        break;
      case "remind":
        await productivity.cmdRemind({ ...ctx, args: [text] });
        break;
      default:
        return false;
    }
    await bump(ctx.env, `flow:${flow}`);
    return true;
  } finally {
    await clearState(ctx.env, ctx.userId);
  }
}

export async function dispatchCallback(
  env: Env,
  origin: string,
  cb: TgCallbackQuery,
  data: string,
): Promise<boolean> {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id ?? 0;
  if (!chatId) return false;

  const ctx: Ctx = {
    env,
    origin,
    chatId,
    userId: cb.from.id,
    msg: cb.message!,
    text: "",
    args: [],
  };

  if (data.startsWith("yt_item:")) {
    return search.showYtItem(env, origin, chatId, messageId, data.slice("yt_item:".length));
  }

  if (data.startsWith("stt:")) {
    const id = Number(data.slice("stt:".length));
    const { qFirst } = await import("../db");
    const row = await qFirst<{ file_id: string }>(
      env,
      "SELECT file_id FROM vault WHERE id = ? AND user_id = ?",
      id,
      cb.from.id,
    );
    if (!row) {
      await sendMessage(env, chatId, "❌ File voice tidak ditemukan di vault.");
      return true;
    }
    await ai.cmdStt(ctx, row.file_id);
    return true;
  }

  if (data.startsWith("flow:")) {
    const spec = PROMPTS[data.slice("flow:".length)];
    if (!spec) return false;
    await setState(env, cb.from.id, spec.flow);
    await sendMessage(env, chatId, spec.text, { keyboard: backMenu() });
    return true;
  }

  if (data.startsWith("mon_")) {
    if (await monitor.handleMonitorCallback(env, chatId, messageId, cb.from.id, data)) return true;
  }

  const idActionPrefixes = [
    "vault_send",
    "vault_del",
    "note_del",
    "todo_done",
    "todo_del",
    "rem_del",
    "rss_del",
    "mon_del",
    "alert_del",
  ];
  const [prefix, rawId] = data.split(":");
  if (idActionPrefixes.includes(prefix)) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) return false;
    return dispatchAction(env, origin, chatId, messageId, cb.from.id, { k: prefix, id } as Action);
  }

  return false;
}

export async function dispatchAction(
  env: Env,
  origin: string,
  chatId: number,
  messageId: number,
  userId: number,
  action: Action,
): Promise<boolean> {
  switch (action.k) {
    case "vault_send":
      await vault.sendVaultItem(env, chatId, action.id, userId);
      return true;
    case "vault_del":
      return vault.deleteVaultItem(env, chatId, messageId, action.id, userId);
    case "note_del":
      return productivity.deleteNote(env, chatId, messageId, action.id, userId);
    case "todo_done":
      return productivity.completeTodo(env, chatId, messageId, action.id, userId);
    case "todo_del":
      return productivity.deleteTodo(env, chatId, messageId, action.id, userId);
    case "rem_del":
      return productivity.deleteReminder(env, chatId, messageId, action.id, userId);
    case "rss_del":
      await qRun(env, "DELETE FROM feeds WHERE id = ? AND user_id = ?", action.id, userId);
      await editMessage(env, chatId, messageId, `🗑 Feed #${action.id} dihapus.`, {
        keyboard: { inline_keyboard: [[{ text: "📡 Daftar Feed", callback_data: "menu:rss" }]] },
      });
      return true;
    case "mon_del":
      await qRun(env, "DELETE FROM monitors WHERE id = ? AND user_id = ?", action.id, userId);
      await editMessage(env, chatId, messageId, `🗑 Monitor #${action.id} dihapus.`, {
        keyboard: { inline_keyboard: [[{ text: "📈 Daftar Monitor", callback_data: "menu:uptime" }]] },
      });
      return true;
    case "alert_del":
      await qRun(env, "DELETE FROM alerts WHERE id = ? AND user_id = ?", action.id, userId);
      await editMessage(env, chatId, messageId, `🗑 Alert #${action.id} dihapus.`, {
        keyboard: { inline_keyboard: [[{ text: "🔔 Daftar Alert", callback_data: "menu:alert" }]] },
      });
      return true;
    case "yt_item":
      return search.showYtItem(env, origin, chatId, messageId, action.videoId);
    default:
      return false;
  }
}

export { handleInline } from "./search";
export { notifyOwnerNewUser } from "./admin";
export { handleGithubWebhook } from "./monitor";
export type { Ctx } from "./context";
