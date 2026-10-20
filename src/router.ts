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
  downloadMenu,
  HELP_TEXT,
  mainMenu,
  aiMenu,
  monitorMenu,
  rateLimited,
  settingMenu,
  SOSMED_PROMPT,
  START_TEXT,
  STORY_TEXT,
  TERABOX_PROMPT,
  toolsMenu,
  TOOLS_TEXT,
  vaultMenu,
  VAULT_TEXT,
  AI_TEXT,
  MONITOR_TEXT,
  SETTING_TEXT,
  YOUTUBE_PROMPT,
} from "./menus";
import { clearState, getState, loadGroup, saveGroup, setState, type Action, type UserState } from "./state";
import { checkRate } from "./ratelimit";
import { detectPlatform } from "./extract";
import { browseTeraBox, getTeraBoxDownload, normalizeShare, type TbBrowse } from "./extract/terabox";
import { deliverMedia, signedMediaUrl } from "./sender";
import { humanSize, type Media } from "./extract/types";
import { showExtract } from "./preview";
import { getOwner, isAllowed, touchUser, type UserRow } from "./users";
import { bump } from "./stats";
import { isOwner } from "./features/admin";
import {
  dispatchAction,
  dispatchCallback,
  dispatchCommand,
  dispatchFlow,
  dispatchMedia,
  handleInline,
  notifyOwnerNewUser,
  type Ctx,
} from "./features";

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

function makeCtx(
  env: Env,
  origin: string,
  msg: TgMessage,
  userId: number,
  text: string,
): Ctx {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const args = text.startsWith("/") ? parts.slice(1) : parts;
  return { env, origin, chatId: msg.chat.id, userId, msg, text, args };
}

export async function handleUpdate(env: Env, update: TgUpdate, origin: string): Promise<void> {
  if (update.message) {
    await handleMessage(env, update.message, origin);
    return;
  }
  if (update.callback_query) {
    await handleCallback(env, update.callback_query, origin);
    return;
  }
  if (update.inline_query) {
    try {
      await handleInline(env, origin, update.inline_query);
    } catch (err) {
      console.warn("inline failed", (err as Error).message);
    }
  }
}

async function handleMessage(env: Env, msg: TgMessage, origin: string): Promise<void> {
  const chatId = msg.chat.id;
  if (!msg.from) return;
  const userId = msg.from.id;

  let user: UserRow;
  try {
    user = await touchUser(env, msg.from);
  } catch (err) {
    console.error("touchUser failed", err);
    await sendMessage(env, chatId, "❌ Database sedang tidak bisa diakses. Coba lagi sebentar.").catch(() => undefined);
    return;
  }

  if (!(await isAllowed(env, user))) {
    if (user.role === "pending" && Date.now() - user.created_at < 60_000) {
      await notifyOwnerNewUser(env, user.id, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "));
    }
    await sendMessage(
      env,
      chatId,
      "⛔ <b>Bot ini privat</b>\n\n" +
        `ID kamu: <code>${userId}</code>\n\n` +
        "Minta owner menambahkan ID ini lewat <code>/allow " +
        userId +
        "</code>.",
    ).catch(() => undefined);
    return;
  }

  const text = (msg.text ?? "").trim();

  // Any file/photo/video/voice is stored in the vault.
  if (msg.document || msg.video || msg.audio || msg.photo || msg.voice) {
    await dispatchMedia(makeCtx(env, origin, msg, userId, text || msg.caption || ""));
    return;
  }

  if (!text) return;

  if (text.startsWith("/")) {
    if (text.toLowerCase().startsWith("/start")) {
      try {
        await env.BOT_KV.put(
          `chat:${userId}`,
          JSON.stringify({
            id: chatId,
            userId,
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

    const ctx = makeCtx(env, origin, msg, userId, text);
    if (await dispatchCommand(ctx, text)) return;
    await handleCommand(env, chatId, userId, text);
    return;
  }

  const state = await getState(env, userId);
  const url = extractFirstUrl(text);
  const urlFlows: UserState["flow"][] = ["rss", "monitor", "ringkas"];

  if (state && state.flow !== "idle" && url && urlFlows.includes(state.flow)) {
    await dispatchFlow(makeCtx(env, origin, msg, userId, text), state.flow);
    return;
  }

  if (url) {
    await handleUrl(env, origin, chatId, userId, url);
    return;
  }

  if (state && state.flow !== "idle") {
    if (["terabox", "sosmed", "youtube", "story"].includes(state.flow)) {
      await sendMessage(env, chatId, promptFor(state.flow), { keyboard: backMenu() });
      return;
    }
    await dispatchFlow(makeCtx(env, origin, msg, userId, text), state.flow);
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
    case "/menu":
      await clearState(env, userId);
      await sendMessage(env, chatId, START_TEXT, { keyboard: mainMenu() });
      return;
    case "/help":
      await sendMessage(env, chatId, HELP_TEXT, { keyboard: backMenu() });
      return;
    case "/id":
      await sendMessage(
        env,
        chatId,
        `Chat ID: <code>${chatId}</code>\nUser ID: <code>${userId}</code>`,
      );
      return;
    case "/cancel":
      await clearState(env, userId);
      await sendMessage(env, chatId, "Dibatalkan. Pilih menu untuk mulai lagi.", { keyboard: mainMenu() });
      return;
    case "/ping":
      await sendMessage(env, chatId, "🏓 Pong!");
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
    await bump(env, `dl:${platform}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    await editMessage(env, chatId, status.message_id, `❌ ${esc(message)}`, { keyboard: backMenu() });
  }
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

  browse.dirs.forEach((dir) => {
    const path = dir.path || `/${dir.server_filename}`;
    actions.push({ k: "tb_page", share, dir: path, page: 1 });
    rows.push([{ text: `📁 ${clip(dir.server_filename, 40)}`, idx: actions.length - 1 }]);
    lines.push(`📁 ${esc(dir.server_filename)}`);
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

  let user: UserRow;
  try {
    user = await touchUser(env, cb.from);
  } catch {
    await answerCallback(env, cb.id, "Database error.");
    return;
  }
  if (!(await isAllowed(env, user))) {
    await answerCallback(env, cb.id, "Akses ditolak.");
    return;
  }

  if (data.startsWith("menu:")) {
    await handleMenu(env, origin, cb, chatId, messageId, data.slice(5));
    return;
  }

  if (data.startsWith("a:")) {
    await handleAction(env, cb, origin, chatId, messageId, data);
    return;
  }

  await answerCallback(env, cb.id);
  await dispatchCallback(env, origin, cb, data);
}

async function handleMenu(
  env: Env,
  origin: string,
  cb: TgCallbackQuery,
  chatId: number,
  messageId: number,
  key: string,
): Promise<void> {
  const userId = cb.from.id;
  await answerCallback(env, cb.id);
  const ctx = makeCtx(env, origin, cb.message!, userId, "");

  switch (key) {
    case "home":
      await clearState(env, userId);
      await editMessage(env, chatId, messageId, START_TEXT, { keyboard: mainMenu() });
      return;
    case "help":
      await editMessage(env, chatId, messageId, HELP_TEXT, { keyboard: backMenu() });
      return;
    case "download":
      await editMessage(env, chatId, messageId, "<b>⬇️ Download</b>\n\nPilih sumber:", { keyboard: downloadMenu() });
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
    case "tools":
      await editMessage(env, chatId, messageId, TOOLS_TEXT, { keyboard: toolsMenu() });
      return;
    case "vault":
      await editMessage(env, chatId, messageId, VAULT_TEXT, { keyboard: vaultMenu() });
      return;
    case "vault_files":
      await dispatchCommand(ctx, "/vault");
      return;
    case "notes":
      await dispatchCommand(ctx, "/notes");
      return;
    case "todos":
      await dispatchCommand(ctx, "/todos");
      return;
    case "reminders":
      await dispatchCommand(ctx, "/reminders");
      return;
    case "ai":
      await editMessage(env, chatId, messageId, AI_TEXT, { keyboard: aiMenu() });
      return;
    case "stt_info":
      await editMessage(
        env,
        chatId,
        messageId,
        "📝 <b>Transkripsi</b>\n\nReply voice note atau file audio dengan <code>/stt</code>.",
        { keyboard: backMenu() },
      );
      return;
    case "monitor":
      await editMessage(env, chatId, messageId, MONITOR_TEXT, { keyboard: monitorMenu() });
      return;
    case "rss":
      await dispatchCommand(ctx, "/rss");
      return;
    case "uptime":
      await dispatchCommand(ctx, "/monitor");
      return;
    case "alert":
      await dispatchCommand(ctx, "/alert");
      return;
    case "github":
      await editMessage(
        env,
        chatId,
        messageId,
        "🐙 <b>GitHub</b>\n\nOwner bisa mengaktifkan notifikasi dengan:\n<code>/gh owner/repo</code>\n\n" +
          "Setelah itu salin Webhook URL dari bot ke pengaturan repo GitHub.",
        { keyboard: monitorMenu() },
      );
      return;
    case "setting":
      await editMessage(env, chatId, messageId, SETTING_TEXT, {
        keyboard: settingMenu(await isOwner(env, userId)),
      });
      return;
    case "status":
      await dispatchCommand(ctx, "/status");
      return;
    case "profile": {
      const owner = await getOwner(env);
      await editMessage(
        env,
        chatId,
        messageId,
        `🆔 <b>Profil</b>\n\nUser ID: <code>${userId}</code>\nChat ID: <code>${chatId}</code>\n` +
          `Role: <b>${userRoleLabel(userId, owner?.id)}</b>`,
        { keyboard: backMenu() },
      );
      return;
    }
    case "stats":
      await dispatchCommand(ctx, "/stats");
      return;
    case "users":
      await dispatchCommand(ctx, "/users");
      return;
    case "backup":
      await dispatchCommand(ctx, "/backup");
      return;
    default:
      await editMessage(env, chatId, messageId, START_TEXT, { keyboard: mainMenu() });
  }
}

function userRoleLabel(userId: number, ownerId?: number): string {
  return userId === ownerId ? "owner" : "member";
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
    if (await dispatchAction(env, origin, chatId, messageId, cb.from.id, action)) return;

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
        await bump(env, `deliver:${result.mode}`);
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
      `📄 <b>${esc(dl.filename)}</b>\n` + `📦 ${dl.size_h || humanSize(dl.size)}\n\n` + `Link berlaku ±${hours} jam.`;
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
