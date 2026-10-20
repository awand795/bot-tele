import type { Ctx } from "./context";
import { argText } from "./context";
import type { Env } from "../env";
import type { TgInlineQuery } from "../types";
import { answerInlineQuery, esc, sendMessage } from "../telegram";
import { getYtInfo, safeName, searchYouTube, VR_UA } from "../extract/youtube";
import { extractMedia } from "../extract";
import { signedMediaUrl } from "../sender";
import { showExtract } from "../preview";
import { humanDuration } from "../extract/types";

export async function cmdSearch(ctx: Ctx): Promise<void> {
  const query = argText(ctx);
  if (!query) {
    await sendMessage(ctx.env, ctx.chatId, "🔍 <b>Cari YouTube</b>\n\n<code>/cari lofi hip hop</code>");
    return;
  }
  await sendMessage(ctx.env, ctx.chatId, `🔍 Mencari <b>${esc(query)}</b>…`);

  const items = await searchYouTube(5, query);
  if (!items.length) {
    await sendMessage(ctx.env, ctx.chatId, "❌ Tidak ada hasil.");
    return;
  }

  const lines = [`🔍 <b>Hasil: ${esc(query)}</b>`, ""];
  const keyboard: any[] = [];
  for (const item of items) {
    lines.push(`<b>${esc(item.title)}</b>`);
    lines.push(
      `${esc(item.author)}${item.duration ? ` · ${humanDuration(item.duration)}` : ""}${
        item.views ? ` · ${esc(item.views)}` : ""
      }`,
    );
    keyboard.push([{ text: `⬇️ ${item.title.slice(0, 45)}`, callback_data: `yt_item:${item.id}` }]);
  }
  keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function showYtItem(
  env: Env,
  origin: string,
  chatId: number,
  messageId: number,
  videoId: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return false;
  try {
    await showExtract(env, origin, chatId, messageId, `https://youtu.be/${videoId}`);
  } catch (err) {
    await sendMessage(env, chatId, `❌ ${esc((err as Error).message)}`);
  }
  return true;
}

function article(query: string, title: string, description: string): any {
  return {
    type: "article",
    id: `t${Math.abs(hash(query + title))}`,
    title,
    description,
    input_message_content: { message_text: query },
  };
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

export async function handleInline(env: Env, origin: string, iq: TgInlineQuery): Promise<void> {
  const query = iq.query.trim();
  if (!query) {
    await answerInlineQuery(env, iq.id, [], {
      cache_time: 10,
    }).catch(() => undefined);
    return;
  }

  try {
    if (/^https?:\/\//i.test(query)) {
      const result = await extractMedia(env, query);
      const results: any[] = [];
      const caption = result.caption.slice(0, 700);

      for (const media of [...result.medias, ...result.extras].slice(0, 10)) {
        const signed = await signedMediaUrl(env, origin, media, 6 * 3600);
        const id = `m${results.length}-${hash(media.filename)}`;

        if (media.kind === "video" && result.cover) {
          results.push({
            type: "video",
            id,
            video_url: signed,
            mime_type: "video/mp4",
            thumbnail_url: result.cover,
            title: result.title.slice(0, 60),
            description: media.filename,
            caption,
            parse_mode: "HTML",
            video_width: media.width ?? 640,
            video_height: media.height ?? 360,
            video_duration: media.duration,
          });
        } else if (media.kind === "audio") {
          results.push({
            type: "audio",
            id,
            audio_url: signed,
            title: (media.title ?? result.title).slice(0, 60),
            performer: media.performer,
            audio_duration: media.duration,
            caption,
            parse_mode: "HTML",
          });
        } else if (media.kind === "photo") {
          results.push({
            type: "photo",
            id,
            photo_url: signed,
            thumbnail_url: signed,
            title: result.title.slice(0, 60),
            caption,
            parse_mode: "HTML",
          });
        } else if (media.kind === "document") {
          results.push({
            type: "document",
            id,
            title: media.filename.slice(0, 60),
            document_url: signed,
            mime_type: "application/octet-stream",
          });
        }
      }

      if (!results.length) {
        results.push(article(query, "Kirim link ke bot", "Media ini tidak bisa diputar inline. Kirim link ke chat bot."));
      }
      await answerInlineQuery(env, iq.id, results, { cache_time: 60 });
      return;
    }

    const items = await searchYouTube(3, query);
    const results: any[] = [];
    for (const item of items) {
      try {
        const info = await getYtInfo(env, item.id);
        if (!info.video) continue;
        const signed = await signedMediaUrl(
          env,
          origin,
          {
            kind: "video",
            url: info.video.url,
            filename: `${safeName(info.title)}.mp4`,
            size: info.video.size,
            duration: info.duration,
            width: 640,
            height: 360,
            title: info.title,
            headers: { "User-Agent": VR_UA },
            yt: { id: item.id, itag: info.video.itag },
          },
          6 * 3600,
        );
        results.push({
          type: "video",
          id: item.id,
          video_url: signed,
          mime_type: "video/mp4",
          thumbnail_url: info.thumb ?? item.thumb,
          title: info.title.slice(0, 60),
          description: `${info.author}${info.duration ? ` · ${humanDuration(info.duration)}` : ""}`,
          video_width: 640,
          video_height: 360,
          video_duration: info.duration,
          caption: `<b>${esc(info.title)}</b>\n${esc(info.author)}`,
          parse_mode: "HTML",
        });
      } catch {
        /* skip item */
      }
    }

    if (!results.length) {
      results.push(article(query, `Cari "${query}" di YouTube`, "Buka YouTube untuk hasil lengkap."));
    }
    await answerInlineQuery(env, iq.id, results, { cache_time: 60 });
  } catch (err) {
    await answerInlineQuery(
      env,
      iq.id,
      [article(query, "Gagal memproses link", (err as Error).message.slice(0, 120))],
      { cache_time: 5 },
    ).catch(() => undefined);
  }
}
