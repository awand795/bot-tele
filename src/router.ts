import type { Env } from "./env";
import type { InlineKeyboardButton, InlineKeyboardMarkup, TgCallbackQuery, TgMessage, TgUpdate } from "./types";
import {
  answerCallback,
  chatAction,
  clip,
  deleteMessage,
  editMessage,
  esc,
  sendMediaGroup,
  sendMessage,
} from "./telegram";
import {
  backMenu,
  HELP_TEXT,
  mainMenu,
  rateLimited,
  SOSMED_PROMPT,
  START_TEXT,
  STORY_TEXT,
  TERABOX_PROMPT,
  YOUTUBE_PROMPT,
} from "./menus";
import { clearState, getState, loadGroup, saveGroup, setState, type Action, type UserState } from "./state";
import { checkRate } from "./ratelimit";
import { detectPlatform, extractMedia } from "./extract";
import { browseTeraBox, getTeraBoxDownload, normalizeShare, type TbBrowse } from "./extract/terabox";
import { deliverMedia, signedMediaUrl } from "./sender";
import { humanDuration, humanSize, type Media } from "./extract/types";

const MAX_TEXT = 3800;

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}

function promptFor(flow: UserState["flow"]): string {
  switch (flow) {
    case "terabox":
      return TERABOX_PROMPT;
    case "sosmed":
      return SOSMED_PROMPT;
    case "youtube":
      return YOUTUBE_PROMPT;
    case "story":
      return STORY_TEXT;
    default:
      return START_TEXT;
  }
}

export async function handleUpdate(env: Env, update: TgUpdate, origin: string): Promise<void> {
  if (update.message) {
    await handleMessage(env, update.message, origin);
    return;
  }
  if (update.callback_query) {
    await handleCallback(env, update.callback_query, origin);
  }
}

async function handleMessage(env: Env, msg: TgMessage, origin: string): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? chatId;
  const text = (msg.text ?? "").trim();
  if (!text) return;

  if (text.startsWith("/")) {
    if (msg.from && text.toLowerCase().startsWith("/start")) {
      try {
        await env.BOT_KV.put(
          `chat:${msg.from.id}`,
          JSON.stringify({
            id: chatId,
            userId: msg.from.id,
            name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
            username: msg.from.username,
            at: Date.now(),
          }),
          { expirationTtl: 30 * 24 * 3600 },
        );
      } catch {
        /* non fatal */
      }
    }
    await handleCommand(env, chatId, userId, text);
    return;
  }

  const url = extractFirstUrl(text);
  if (url) {
    await handleUrl(env, origin, chatId, userId, url);
    return;
  }

  const state = await getState(env, userId);
  if (state && state.flow !== "idle") {
    await sendMessage(env, chatId, promptFor(state.flow), { keyboard: backMenu() });
    return;
  }

  await sendMessage(env, chatId, START_TEXT, { keyboard: mainMenu() });
}

async function handleCommand(env: Env, chatId: number, userId: number, text: string): Promise<void> {
  const command = text.split(/\s+/)[0].toLowerCase().split("@")[0];
  switch (command) {
    case "/start":
      await clearState(env, userId);
      await sendMessage(env, chatId, START_TEXT, { keyboard: mainMenu() });
      return;
    case "/help":
      await sendMessage(env, chatId, HELP_TEXT, { keyboard: backMenu() });
      return;
    case "/id":
      await sendMessage(env, chatId, `Chat ID: <code>${chatId}</code>\nUser ID: <code>${userId}</code>`);
      return;
    case "/cancel":
      await clearState(env, userId);
      await sendMessage(env, chatId, "Dibatalkan. Pilih menu untuk mulai lagi.", { keyboard: mainMenu() });
      return;
    default:
      await sendMessage(env, chatId, "Command tidak dikenal. Lihat /help.", { keyboard: backMenu() });
  }
}

async function handleUrl(env: Env, origin: string, chatId: number, userId: number, rawUrl: string): Promise<void> {
  const platform = detectPlatform(rawUrl);
  if (!platform) {
    await sendMessage(
      env,
      chatId,
      "❌ Link tidak dikenali.\n\nYang didukung: TikTok, Instagram, Facebook, YouTube, dan TeraBox.",
      { keyboard: backMenu() },
    );
    return;
  }

  const rate = await checkRate(env, userId);
  if (!rate.ok) {
    await sendMessage(env, chatId, rateLimited(rate.resetInMinutes), { keyboard: backMenu() });
    return;
  }

  await chatAction(env, chatId, "typing");
  const status = await sendMessage(env, chatId, "⏳ Memproses link…");

  try {
    if (platform === "terabox") {
      const share = normalizeShare(rawUrl);
      if (!share) throw new Error("Link TeraBox tidak valid. Contoh: https://terabox.com/s/1AbCdEf");
      const browse = await browseTeraBox(env, share, "/", 1);
      await renderTeraBox(env, share, browse, chatId, status.message_id);
    } else {
      await showExtract(env, origin, chatId, status.message_id, rawUrl);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    await editMessage(env, chatId, status.message_id, `❌ ${esc(message)}`, { keyboard: backMenu() });
  }
}

async function showExtract(env: Env, origin: string, chatId: number, messageId: number, url: string): Promise<void> {
  const result = await extractMedia(env, url);
  if (!result.medias.length) throw new Error("Tidak ada media yang bisa diambil dari link itu.");

  const actions: Action[] = [];
  const specs: Array<Array<{ text: string; idx: number }>> = [];

  const push = (action: Action, label: string) => {
    actions.push(action);
    return { text: label, idx: actions.length - 1 };
  };

  if (result.medias.length > 1) {
    const album = push({ k: "album", medias: result.medias, caption: result.caption }, `📥 Semua (${result.medias.length})`);
    specs.push([album]);
  } else {
    const media = result.medias[0];
    const label =
      media.kind === "video"
        ? `🎬 Video${media.size ? ` (${humanSize(media.size)})` : ""}`
        : media.kind === "audio"
          ? "🎵 Audio"
          : media.kind === "photo"
            ? "🖼 Foto"
            : "📄 File";
    specs.push([push({ k: "media", media, caption: result.caption }, label)]);
  }

  const extraButtons = result.extras.map((extra) =>
    push(
      { k: "media", media: extra, caption: `<b>${esc(extra.title ?? "Audio")}</b>` },
      extra.kind === "audio" ? "🎵 Audio M4A" : "📄 File",
    ),
  );
  if (extraButtons.length) specs.push(extraButtons);

  specs.push([push({ k: "media", media: result.medias[0], caption: result.caption }, "📥 Download Ulang")]);

  const gid = await saveGroup(env, actions);
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: specs.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: `a:${gid}:${b.idx}` })),
    ),
  };
  keyboard.inline_keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);

  const first = result.medias[0];
  const meta: string[] = [];
  if (first.size) meta.push(`📦 ${humanSize(first.size)}`);
  if (first.duration) meta.push(`⏱ ${humanDuration(first.duration)}`);
  if (result.medias.length > 1) meta.push(`🖼 ${result.medias.length} media`);

  const text = clip(`${result.caption}\n\n${meta.join(" · ")}`, MAX_TEXT);
  await editMessage(env, chatId, messageId, text, { keyboard });
}

interface ButtonSpec {
  text: string;
  idx?: number;
  url?: string;
}

async function renderTeraBox(
  env: Env,
  share: string,
  browse: TbBrowse,
  chatId: number,
  messageId: number,
): Promise<void> {
  const actions: Action[] = [];
  const rows: ButtonSpec[][] = [];
  const title = browse.title || "TeraBox";

  const singleFile = browse.files.length === 1 && browse.dirs.length === 0;

  if (singleFile) {
    const f = browse.files[0];
    const fsId = String(f.fs_id);
    actions.push({ k: "tb_dl", share, fsId, name: f.server_filename });
    const dlIdx = actions.length - 1;
    actions.push({ k: "tb_send", share, fsId, name: f.server_filename, size: f.size });
    const sendIdx = actions.length - 1;

    rows.push([
      { text: "⬇️ Link Download", idx: dlIdx },
      { text: "📤 Kirim ke Telegram", idx: sendIdx },
    ]);

    const gid = await saveGroup(env, actions);
    const keyboard = toKeyboard(rows, gid);
    keyboard.inline_keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);

    const text =
      `📦 <b>${esc(title.replace(/^\//, ""))}</b>\n\n` +
      `📄 ${esc(f.server_filename)}\n` +
      `📦 ${f.size_h || humanSize(f.size)}`;
    await editMessage(env, chatId, messageId, text, { keyboard });
    return;
  }

  const lines: string[] = [`<b>📦 ${esc(title)}</b>`];
  const summary: string[] = [];
  if (browse.dirs.length) summary.push(`📁 ${browse.dirs.length} folder`);
  if (browse.files.length) summary.push(`📄 ${browse.files.length} file`);
  if (summary.length) lines.push(summary.join(" · "));
  lines.push("");

  browse.dirs.forEach((dir, i) => {
    const path = dir.path || `/${dir.server_filename}`;
    actions.push({ k: "tb_page", share, dir: path, page: 1 });
    rows.push([{ text: `📁 ${clip(dir.server_filename, 40)}`, idx: actions.length - 1 }]);
    lines.push(`📁 ${esc(dir.server_filename)}`);
    void i;
  });

  browse.files.forEach((file, i) => {
    const fsId = String(file.fs_id);
    actions.push({ k: "tb_dl", share, fsId, name: file.server_filename });
    const dlIdx = actions.length - 1;
    actions.push({ k: "tb_send", share, fsId, name: file.server_filename, size: file.size });
    const sendIdx = actions.length - 1;

    lines.push(`${i + 1}. ${esc(file.server_filename)} — ${file.size_h || humanSize(file.size)}`);
    rows.push([
      { text: `⬇️ ${i + 1}`, idx: dlIdx },
      { text: `📤 ${i + 1}`, idx: sendIdx },
    ]);
  });

  const nav: ButtonSpec[] = [];
  if (browse.page > 1) {
    actions.push({ k: "tb_page", share, dir: browse.dir, page: browse.page - 1 });
    nav.push({ text: "⬅️ Sebelumnya", idx: actions.length - 1 });
  }
  if (browse.has_more) {
    actions.push({ k: "tb_page", share, dir: browse.dir, page: browse.page + 1 });
    nav.push({ text: "Berikutnya ➡️", idx: actions.length - 1 });
  }
  if (nav.length) rows.push(nav);

  const gid = await saveGroup(env, actions);
  const keyboard = toKeyboard(rows, gid);
  keyboard.inline_keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);

  await editMessage(env, chatId, messageId, clip(lines.join("\n"), MAX_TEXT), { keyboard });
}

function toKeyboard(rows: ButtonSpec[][], gid: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b): InlineKeyboardButton => {
        if (b.url) return { text: b.text, url: b.url };
        return { text: b.text, callback_data: `a:${gid}:${b.idx}` };
      }),
    ),
  };
}

async function handleCallback(env: Env, cb: TgCallbackQuery, origin: string): Promise<void> {
  const data = cb.data ?? "";
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;

  if (!chatId || !messageId) {
    await answerCallback(env, cb.id);
    return;
  }

  if (data.startsWith("menu:")) {
    await handleMenu(env, cb, chatId, messageId, data.slice(5));
    return;
  }

  if (data.startsWith("a:")) {
    await handleAction(env, cb, origin, chatId, messageId, data);
    return;
  }

  await answerCallback(env, cb.id);
}

async function handleMenu(env: Env, cb: TgCallbackQuery, chatId: number, messageId: number, key: string): Promise<void> {
  const userId = cb.from.id;
  await answerCallback(env, cb.id);

  switch (key) {
    case "home":
      await clearState(env, userId);
      await editMessage(env, chatId, messageId, START_TEXT, { keyboard: mainMenu() });
      return;
    case "help":
      await editMessage(env, chatId, messageId, HELP_TEXT, { keyboard: backMenu() });
      return;
    case "terabox":
      await setState(env, userId, "terabox");
      await editMessage(env, chatId, messageId, TERABOX_PROMPT, { keyboard: backMenu() });
      return;
    case "sosmed":
      await setState(env, userId, "sosmed");
      await editMessage(env, chatId, messageId, SOSMED_PROMPT, { keyboard: backMenu() });
      return;
    case "youtube":
      await setState(env, userId, "youtube");
      await editMessage(env, chatId, messageId, YOUTUBE_PROMPT, { keyboard: backMenu() });
      return;
    case "story":
      await editMessage(env, chatId, messageId, STORY_TEXT, { keyboard: backMenu() });
      return;
    default:
      await editMessage(env, chatId, messageId, START_TEXT, { keyboard: mainMenu() });
  }
}

async function handleAction(
  env: Env,
  cb: TgCallbackQuery,
  origin: string,
  chatId: number,
  messageId: number,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  const gid = parts[1];
  const idx = Number(parts[2]);
  const actions = await loadGroup(env, gid);
  if (!actions || !Number.isInteger(idx) || !actions[idx]) {
    await answerCallback(env, cb.id, "Sesi kedaluwarsa. Kirim ulang link.");
    return;
  }

  const action = actions[idx];
  await answerCallback(env, cb.id);

  try {
    switch (action.k) {
      case "tb_dl":
        await teraBoxLink(env, chatId, action.share, action.fsId);
        return;
      case "tb_send":
        await teraBoxSend(env, origin, chatId, action.share, action.fsId, action.name);
        return;
      case "tb_page": {
        await chatAction(env, chatId, "typing");
        const browse = await browseTeraBox(env, action.share, action.dir, action.page);
        await renderTeraBox(env, action.share, browse, chatId, messageId);
        return;
      }
      case "media": {
        const result = await deliverMedia(env, origin, chatId, action.media, action.caption);
        await markDone(env, chatId, messageId, result.mode);
        return;
      }
      case "album": {
        await sendAlbum(env, origin, chatId, action.medias, action.caption);
        await markDone(env, chatId, messageId, "url");
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    await sendMessage(env, chatId, `❌ ${esc(message)}`, { keyboard: backMenu() });
  }
}

async function markDone(env: Env, chatId: number, messageId: number, mode: string): Promise<void> {
  const label = mode === "link" ? "✅ Link dikirim" : "✅ Terkirim";
  try {
    await editMessage(env, chatId, messageId, label, {
      keyboard: { inline_keyboard: [[{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]] },
    });
  } catch {
    /* message may be too old */
  }
}

async function sendAlbum(env: Env, origin: string, chatId: number, medias: Media[], caption?: string): Promise<void> {
  const items: Array<{ kind: "photo" | "video"; url: string; caption?: string }> = [];
  for (const media of medias.slice(0, 10)) {
    if (media.kind !== "photo" && media.kind !== "video") continue;
    items.push({ kind: media.kind, url: await signedMediaUrl(env, origin, media), caption });
  }
  if (!items.length) throw new Error("Tidak ada media yang bisa dikirim.");
  if (items.length === 1) {
    await deliverMedia(env, origin, chatId, medias[0], caption);
    return;
  }
  await sendMediaGroup(env, chatId, items);
}

async function teraBoxLink(env: Env, chatId: number, share: string, fsId: string): Promise<void> {
  const wait = await sendMessage(env, chatId, "⏳ Membuat link download…");
  try {
    const dl = await getTeraBoxDownload(env, share, fsId);
    const hours = Math.max(1, Math.round((dl.expires_in_s || 3600) / 3600));
    const text =
      `📄 <b>${esc(dl.filename)}</b>\n` +
      `📦 ${dl.size_h || humanSize(dl.size)}\n\n` +
      `Link berlaku ±${hours} jam.`;
    await editMessage(env, chatId, wait.message_id, text, {
      keyboard: {
        inline_keyboard: [
          [{ text: "⬇️ Download", url: dl.url }],
          [{ text: "⬅️ Menu Utama", callback_data: "menu:home" }],
        ],
      },
    });
  } catch (err) {
    await editMessage(env, chatId, wait.message_id, `❌ ${esc((err as Error).message)}`, { keyboard: backMenu() });
  }
}

function kindFromName(name: string): Media["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "m4v", "mov", "webm", "ts"].includes(ext)) return "video";
  if (["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "photo";
  return "document";
}

async function teraBoxSend(
  env: Env,
  origin: string,
  chatId: number,
  share: string,
  fsId: string,
  name: string,
): Promise<void> {
  const wait = await sendMessage(env, chatId, "⏳ Menyiapkan file…");
  try {
    const dl = await getTeraBoxDownload(env, share, fsId);
    const filename = dl.filename && !dl.filename.startsWith("terabox_") ? dl.filename : name;
    const media: Media = {
      kind: kindFromName(filename),
      url: dl.url,
      filename,
      size: dl.size,
      tb: { share, fsId },
    };
    await deliverMedia(env, origin, chatId, media, `📦 <b>${esc(filename)}</b>`);
    await deleteMessage(env, chatId, wait.message_id);
  } catch (err) {
    await editMessage(env, chatId, wait.message_id, `❌ ${esc((err as Error).message)}`, { keyboard: backMenu() });
  }
}
