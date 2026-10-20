import type { Env } from "./env";
import type { InlineKeyboardMarkup } from "./types";

export class TgError extends Error {
  constructor(public method: string, public description: string, public code?: number) {
    super(`Telegram ${method} failed: ${description}`);
  }
}

const apiUrl = (env: Env, method: string) => `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

export async function tg<T = any>(env: Env, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(apiUrl(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) throw new TgError(method, data.description ?? "unknown", data.error_code);
  return data.result as T;
}

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clip(text: string, max = 900): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export interface SendMessageOpts {
  keyboard?: InlineKeyboardMarkup;
  disablePreview?: boolean;
  parseMode?: "HTML" | "MarkdownV2" | "";
}

export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  opts: SendMessageOpts = {},
): Promise<any> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: opts.disablePreview ?? true },
  };
  if (opts.parseMode !== "") payload.parse_mode = opts.parseMode ?? "HTML";
  if (opts.keyboard) payload.reply_markup = opts.keyboard;
  return tg(env, "sendMessage", payload);
}

export async function editMessage(
  env: Env,
  chatId: number | string,
  messageId: number,
  text: string,
  opts: SendMessageOpts = {},
): Promise<any> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    link_preview_options: { is_disabled: opts.disablePreview ?? true },
  };
  if (opts.parseMode !== "") payload.parse_mode = opts.parseMode ?? "HTML";
  if (opts.keyboard) payload.reply_markup = opts.keyboard;
  return tg(env, "editMessageText", payload);
}

export async function answerCallback(env: Env, id: string, text?: string): Promise<void> {
  try {
    await tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: false });
  } catch {
    /* ignore expired callbacks */
  }
}

export async function chatAction(env: Env, chatId: number | string, action = "typing"): Promise<void> {
  try {
    await tg(env, "sendChatAction", { chat_id: chatId, action });
  } catch {
    /* non fatal */
  }
}

export interface MediaTarget {
  kind: "video" | "audio" | "photo" | "document";
  url: string;
  caption?: string;
  filename?: string;
  duration?: number;
  width?: number;
  height?: number;
  title?: string;
  performer?: string;
}

/** Send media by handing Telegram a URL it will download itself. */
export async function sendMediaByUrl(env: Env, chatId: number | string, m: MediaTarget): Promise<any> {
  const base: Record<string, unknown> = { chat_id: chatId };
  if (m.caption) {
    base.caption = clip(m.caption, 1000);
    base.parse_mode = "HTML";
  }

  switch (m.kind) {
    case "video":
      return tg(env, "sendVideo", {
        ...base,
        video: m.url,
        duration: m.duration ?? 0,
        width: m.width,
        height: m.height,
        supports_streaming: true,
      });
    case "audio":
      return tg(env, "sendAudio", {
        ...base,
        audio: m.url,
        duration: m.duration ?? 0,
        title: m.title ? clip(m.title, 60) : undefined,
        performer: m.performer ? clip(m.performer, 60) : undefined,
      });
    case "photo":
      return tg(env, "sendPhoto", { ...base, photo: m.url });
    default:
      return tg(env, "sendDocument", { ...base, document: m.url });
  }
}

const METHOD_FOR: Record<MediaTarget["kind"], string> = {
  video: "sendVideo",
  audio: "sendAudio",
  photo: "sendPhoto",
  document: "sendDocument",
};

const FIELD_FOR: Record<MediaTarget["kind"], string> = {
  video: "video",
  audio: "audio",
  photo: "photo",
  document: "document",
};

function safeFilename(name: string, kind: MediaTarget["kind"]): string {
  const base = (name || "file").replace(/[\r\n"\\]/g, "_").slice(0, 120);
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  const ext = kind === "video" ? ".mp4" : kind === "audio" ? ".m4a" : kind === "photo" ? ".jpg" : ".bin";
  return base + ext;
}

function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  fileField: string,
  filename: string,
  contentType: string,
  fileStream: ReadableStream<Uint8Array>,
  fileSize: number,
) {
  const encoder = new TextEncoder();
  let head = "";
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;

  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(`\r\n--${boundary}--\r\n`);
  const total = headBytes.byteLength + fileSize + tailBytes.byteLength;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(headBytes);
      const reader = fileStream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
      } finally {
        controller.enqueue(tailBytes);
        controller.close();
      }
    },
  });

  return { body, total, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Upload a stream to Telegram without buffering the whole file in memory.
 * `fileStream` must yield exactly `fileSize` bytes.
 */
export async function sendMediaByStream(
  env: Env,
  chatId: number | string,
  m: MediaTarget,
  fileStream: ReadableStream<Uint8Array>,
  fileSize: number,
): Promise<any> {
  const method = METHOD_FOR[m.kind];
  const field = FIELD_FOR[m.kind];
  const boundary = "----bot" + crypto.randomUUID().replace(/-/g, "");
  const filename = safeFilename(m.filename ?? "file", m.kind);

  const fields: Record<string, string> = { chat_id: String(chatId) };
  if (m.caption) {
    fields.caption = clip(m.caption, 1000);
    fields.parse_mode = "HTML";
  }
  if (m.kind === "video") {
    fields.supports_streaming = "true";
    if (m.duration) fields.duration = String(m.duration);
    if (m.width) fields.width = String(m.width);
    if (m.height) fields.height = String(m.height);
  }
  if (m.kind === "audio") {
    if (m.duration) fields.duration = String(m.duration);
    if (m.title) fields.title = clip(m.title, 60);
    if (m.performer) fields.performer = clip(m.performer, 60);
  }

  const contentType =
    m.kind === "video"
      ? "video/mp4"
      : m.kind === "audio"
        ? "audio/mp4"
        : m.kind === "photo"
          ? "image/jpeg"
          : "application/octet-stream";

  const { body, total, contentType: ct } = buildMultipart(
    boundary,
    fields,
    field,
    filename,
    contentType,
    fileStream,
    fileSize,
  );

  const headers: Record<string, string> = { "Content-Type": ct };
  // Content-Length lets Telegram avoid chunked encoding. If the runtime refuses,
  // we retry without it below.
  headers["Content-Length"] = String(total);

  const res = await fetch(apiUrl(env, method), { method: "POST", headers, body });

  const data: any = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) throw new TgError(method, data.description ?? "unknown", data.error_code);
  return data.result;
}

export async function deleteMessage(env: Env, chatId: number | string, messageId: number): Promise<void> {
  try {
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    /* ignore */
  }
}

export async function sendMediaGroup(
  env: Env,
  chatId: number | string,
  items: Array<{ kind: "photo" | "video"; url: string; caption?: string }>,
): Promise<any> {
  const media = items.slice(0, 10).map((it, i) => ({
    type: it.kind,
    media: it.url,
    caption: i === 0 ? (it.caption ? clip(it.caption, 1000) : undefined) : undefined,
    parse_mode: "HTML",
  }));
  return tg(env, "sendMediaGroup", { chat_id: chatId, media });
}

/** Re-send a file that already lives on Telegram, using its file_id. */
export async function sendByFileId(
  env: Env,
  chatId: number | string,
  kind: "video" | "audio" | "photo" | "document" | "voice",
  fileId: string,
  caption?: string,
): Promise<any> {
  const method =
    kind === "video"
      ? "sendVideo"
      : kind === "audio"
        ? "sendAudio"
        : kind === "photo"
          ? "sendPhoto"
          : kind === "voice"
            ? "sendVoice"
            : "sendDocument";
  const payload: Record<string, unknown> = { chat_id: chatId, [kind]: fileId };
  if (caption) {
    payload.caption = clip(caption, 1000);
    payload.parse_mode = "HTML";
  }
  return tg(env, method, payload);
}

export async function answerInlineQuery(
  env: Env,
  id: string,
  results: unknown[],
  opts: { cache_time?: number; is_personal?: boolean } = {},
): Promise<any> {
  return tg(env, "answerInlineQuery", {
    inline_query_id: id,
    results,
    cache_time: opts.cache_time ?? 30,
    is_personal: opts.is_personal ?? true,
  });
}

export async function getFileBytes(env: Env, fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const file = await tg<{ file_path?: string }>(env, "getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("File Telegram tidak ditemukan.");
  const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error(`Gagal mengunduh file dari Telegram (${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
}

export async function sendBytes(
  env: Env,
  method: "sendPhoto" | "sendAudio" | "sendDocument" | "sendVoice",
  field: "photo" | "audio" | "document" | "voice",
  chatId: number | string,
  bytes: Uint8Array,
  filename: string,
  mime: string,
  extra: Record<string, string> = {},
): Promise<any> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  for (const [k, v] of Object.entries(extra)) {
    if (v) form.append(k, v);
  }
  form.append(field, new Blob([bytes], { type: mime }), filename);

  const res = await fetch(apiUrl(env, method), { method: "POST", body: form });
  const data: any = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) throw new TgError(method, data.description ?? "unknown", data.error_code);
  return data.result;
}

export function sendPhotoBytes(
  env: Env,
  chatId: number | string,
  bytes: Uint8Array,
  caption?: string,
  mime = "image/jpeg",
  filename = "image.jpg",
): Promise<any> {
  return sendBytes(env, "sendPhoto", "photo", chatId, bytes, filename, mime, {
    ...(caption ? { caption: clip(caption, 1000), parse_mode: "HTML" } : {}),
  });
}

export function sendAudioBytes(
  env: Env,
  chatId: number | string,
  bytes: Uint8Array,
  filename = "audio.mp3",
  mime = "audio/mpeg",
  extra: Record<string, string> = {},
): Promise<any> {
  return sendBytes(env, "sendAudio", "audio", chatId, bytes, filename, mime, extra);
}

export function sendDocumentBytes(
  env: Env,
  chatId: number | string,
  bytes: Uint8Array,
  filename = "file.bin",
  mime = "application/octet-stream",
  extra: Record<string, string> = {},
): Promise<any> {
  return sendBytes(env, "sendDocument", "document", chatId, bytes, filename, mime, extra);
}

export function splitText(text: string, max = 3800): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [""];
}

