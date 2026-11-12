import type { Env } from "./env";
import { LIMITS } from "./env";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./types";
import { clip, editMessage, esc } from "./telegram";
import { saveGroup, type Action } from "./state";
import { humanDuration, humanSize, type ExtractResult, type Media } from "./extract/types";
import { signPayload } from "./crypto";
import { extractMedia } from "./extract";
import { safeName } from "./extract/youtube";

const MAX_TEXT = 3800;

/**
 * Tombol untuk halaman yang menggabungkan video HD (tanpa audio) dengan audio
 * di browser user. Hanya relevan untuk hasil YouTube.
 */
async function muxButton(
  env: Env,
  origin: string,
  result: ExtractResult,
  video: Media,
  audio?: Media,
): Promise<{ text: string; url: string } | null> {
  if (!video.yt || !audio?.yt || !video.height) return null;

  const height = video.height;
  const token = await signPayload(
    env,
    {
      t: "mux",
      id: video.yt.id,
      vitag: video.yt.itag,
      aitag: audio.yt.itag,
      height,
      name: `${safeName(result.title)}_${height}p.mp4`,
      title: result.title.slice(0, 90),
      size: video.size ?? 0,
    },
    LIMITS.LINK_TTL,
  );

  return { text: `🔊 ${height}p + suara`, url: `${origin}/m/${token}` };
}

/** Button label for an alternative download (audio track, silent HD video, …). */
function extraLabel(extra: Media): string {
  if (extra.kind === "audio") return "🎵 Audio M4A";
  if (extra.kind === "video" && extra.height && extra.height > 360) {
    const size = extra.size ? ` · ${humanSize(extra.size)}` : "";
    return `🎬 ${extra.height}p tanpa suara${size}`;
  }
  return "📄 File";
}

/** Turn an extraction result into a preview message with download buttons. */
export async function showExtract(
  env: Env,
  origin: string,
  chatId: number,
  messageId: number,
  url: string,
): Promise<void> {
  const result = await extractMedia(env, url);
  if (!result.medias.length) throw new Error("Tidak ada media yang bisa diambil dari link itu.");

  const actions: Action[] = [];
  const specs: Array<Array<{ text: string; idx?: number; url?: string }>> = [];
  const audioExtra = result.extras.find((e) => e.kind === "audio");

  const push = (action: Action, label: string) => {
    actions.push(action);
    return { text: label, idx: actions.length - 1 };
  };

  if (result.medias.length > 1) {
    const album = push(
      { k: "album", medias: result.medias, caption: result.caption },
      `📥 Semua (${result.medias.length})`,
    );
    specs.push([album]);
  } else {
    const media = result.medias[0];
    const label =
      media.kind === "video"
        ? `🎬 Video${media.silent ? " tanpa suara" : ""}${media.size ? ` (${humanSize(media.size)})` : ""}`
        : media.kind === "audio"
          ? "🎵 Audio"
          : media.kind === "photo"
            ? "🖼 Foto"
            : "📄 File";
    const silentButton = push({ k: "media", media, caption: result.caption }, label);
    const mergedButton = media.silent ? await muxButton(env, origin, result, media, audioExtra) : null;
    // Tombol bersuara didahulukan supaya user tidak terlanjur mengunduh versi senyap.
    specs.push(mergedButton ? [mergedButton, silentButton] : [silentButton]);
  }

  const extraButton = (extra: Media) =>
    push({ k: "media", media: extra, caption: `<b>${esc(extra.title ?? "Audio")}</b>` }, extraLabel(extra));

  // Audio and the silent HD videos go on their own rows so the labels stay readable.
  const audioButtons = result.extras.filter((e) => e.kind === "audio").map(extraButton);
  const otherButtons = result.extras.filter((e) => e.kind !== "audio" && e.kind !== "video").map(extraButton);
  if (audioButtons.length) specs.push(audioButtons);

  for (const extra of result.extras.filter((e) => e.kind === "video")) {
    const silentButton = extraButton(extra);
    const merged = await muxButton(env, origin, result, extra, audioExtra);
    specs.push(merged ? [merged, silentButton] : [silentButton]);
  }

  if (otherButtons.length) specs.push(otherButtons);

  specs.push([push({ k: "media", media: result.medias[0], caption: result.caption }, "📥 Download Ulang")]);

  const gid = await saveGroup(env, actions);
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: specs.map((row) =>
      row.map(
        (b): InlineKeyboardButton =>
          b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: `a:${gid}:${b.idx ?? 0}` },
      ),
    ),
  };
  keyboard.inline_keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);

  const first = result.medias[0];
  const meta: string[] = [];
  if (first.size) meta.push(`📦 ${humanSize(first.size)}`);
  if (first.duration) meta.push(`⏱ ${humanDuration(first.duration)}`);
  if (result.medias.length > 1) meta.push(`🖼 ${result.medias.length} media`);

  const silentNote = result.medias[0]?.silent ||
    result.extras.some((m) => m.kind === "video" && m.height && m.height > 360)
    ? "\n\n<i>ℹ️ YouTube tidak menyediakan satu file HD bersuara. Tombol 🔊 membuka halaman yang menggabungkan video + audio di perangkat kamu; tombol 🎬 mengirim video tanpa suara.</i>"
    : "";

  const text = clip(`${result.caption}\n\n${meta.join(" · ")}${silentNote}`, MAX_TEXT);
  await editMessage(env, chatId, messageId, text, { keyboard });
}
