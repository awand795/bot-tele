import type { Env } from "./env";
import type { InlineKeyboardMarkup } from "./types";
import { clip, editMessage, esc } from "./telegram";
import { saveGroup, type Action } from "./state";
import { humanDuration, humanSize } from "./extract/types";
import { extractMedia } from "./extract";

const MAX_TEXT = 3800;

/** Turn an extraction result into a preview message with download buttons. */
export async function showExtract(
  env: Env,
  origin: string,
  chatId: number,
  messageId: number,
  url: string,
): Promise<void> {
  void origin;
  const result = await extractMedia(env, url);
  if (!result.medias.length) throw new Error("Tidak ada media yang bisa diambil dari link itu.");

  const actions: Action[] = [];
  const specs: Array<Array<{ text: string; idx: number }>> = [];

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
    inline_keyboard: specs.map((row) => row.map((b) => ({ text: b.text, callback_data: `a:${gid}:${b.idx}` }))),
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
