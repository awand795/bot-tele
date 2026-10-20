import type { Env } from "./env";
import { LIMITS } from "./env";
import { signPayload } from "./crypto";
import { esc, sendMediaByStream, sendMediaByUrl, sendMessage, TgError } from "./telegram";
import { humanSize, type Media } from "./extract/types";
import { isMediaContentType, MediaFetchError, payloadForMedia, resolveStream } from "./resolve";

export async function signedMediaUrl(env: Env, origin: string, media: Media, ttl = LIMITS.LINK_TTL): Promise<string> {
  const token = await signPayload(env, payloadForMedia(media) as unknown as Record<string, unknown>, ttl);
  return `${origin}/dl/${token}`;
}

function linkMessage(env: Env, chatId: number | string, media: Media, url: string, note?: string) {
  const text =
    `📄 <b>${esc(media.filename)}</b>\n` +
    `📦 ${humanSize(media.size)}\n` +
    (note ? `\n${note}\n` : "") +
    `\nLink berlaku ±2 jam.`;
  return sendMessage(env, chatId, text, {
    keyboard: { inline_keyboard: [[{ text: "⬇️ Download", url }]] },
    disablePreview: true,
  });
}

/**
 * Deliver a media item to Telegram:
 *  - <= 20MB  : Telegram downloads it from our signed proxy URL
 *  - <= 45MB  : we stream it to the Bot API
 *  - bigger   : we send a direct download link
 */
export async function deliverMedia(
  env: Env,
  origin: string,
  chatId: number | string,
  media: Media,
  caption?: string,
): Promise<{ mode: "url" | "upload" | "link" }> {
  const url = await signedMediaUrl(env, origin, media);
  const target = {
    kind: media.kind,
    url,
    caption,
    filename: media.filename,
    duration: media.duration,
    width: media.width,
    height: media.height,
    title: media.title,
    performer: media.performer,
  };

  if (media.size && media.size > LIMITS.UPLOAD_MAX) {
    await linkMessage(
      env,
      chatId,
      media,
      url,
      `⚠️ File lebih dari ${Math.round(LIMITS.UPLOAD_MAX / 1024 / 1024)} MB, jadi dikirim sebagai link.`,
    );
    return { mode: "link" };
  }

  if (!media.size || media.size <= LIMITS.URL_MAX) {
    try {
      await sendMediaByUrl(env, chatId, target);
      return { mode: "url" };
    } catch (err) {
      if (media.size && media.size > LIMITS.UPLOAD_MAX) {
        await linkMessage(env, chatId, media, url, "⚠️ Telegram gagal mengambil file, pakai link berikut.");
        return { mode: "link" };
      }
      // fall through to upload attempt
      console.warn("url delivery failed", (err as Error).message);
    }
  }

  try {
    const resolved = await resolveStream(env, payloadForMedia(media), null);
    const status = resolved.response.status;

    if (!resolved.response.ok && status !== 206) {
      await resolved.response.body?.cancel().catch(() => {});
      throw new MediaFetchError(
        `Sumber media membalas HTTP ${status}.`,
        status,
        resolved.contentType,
      );
    }

    if (!isMediaContentType(media.kind, resolved.contentType)) {
      await resolved.response.body?.cancel().catch(() => {});
      throw new MediaFetchError(
        `Sumber mengirim ${resolved.contentType || "respons tak dikenal"}, bukan ${media.kind}.`,
        status,
        resolved.contentType,
      );
    }

    const length = media.size ?? resolved.size;
    if (!resolved.response.body || !length) throw new Error("ukuran file tidak diketahui");
    if (length > LIMITS.UPLOAD_MAX) {
      await linkMessage(env, chatId, media, url, "⚠️ File terlalu besar untuk diunggah bot.");
      return { mode: "link" };
    }
    await sendMediaByStream(env, chatId, target, resolved.response.body, length);
    return { mode: "upload" };
  } catch (err) {
    if (err instanceof MediaFetchError) throw err;
    if (err instanceof TgError) console.warn("upload delivery failed", err.description);
    else console.warn("upload delivery failed", (err as Error).message);
    await linkMessage(env, chatId, media, url, "⚠️ Gagal upload langsung, pakai link berikut.");
    return { mode: "link" };
  }
}
