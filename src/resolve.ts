import type { Env } from "./env";
import type { Media } from "./extract/types";
import { resolveYtStream, VR_UA } from "./extract/youtube";
import { getTeraBoxDownload, TB_UA } from "./extract/terabox";

export type StreamPayload =
  | { t: "u"; url: string; headers?: Record<string, string>; filename?: string }
  | { t: "yt"; id: string; itag: number; filename?: string }
  | { t: "tb"; share: string; fsId: string; filename?: string };

export function payloadForMedia(media: Media): StreamPayload {
  if (media.yt) return { t: "yt", id: media.yt.id, itag: media.yt.itag, filename: media.filename };
  if (media.tb) return { t: "tb", share: media.tb.share, fsId: media.tb.fsId, filename: media.filename };
  return { t: "u", url: media.url, headers: media.headers, filename: media.filename };
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export interface ResolvedStream {
  response: Response;
  filename: string;
  size?: number;
  contentType: string;
}

export async function resolveStream(
  env: Env,
  payload: StreamPayload,
  range?: string | null,
): Promise<ResolvedStream> {
  let url: string;
  let headers: Record<string, string> = { "User-Agent": DEFAULT_UA };
  let filename = payload.filename || "file";

  if (payload.t === "yt") {
    const stream = await resolveYtStream(env, payload.id, payload.itag);
    url = stream.url;
    headers = { "User-Agent": VR_UA, Referer: "https://www.youtube.com/" };
    filename = payload.filename || `${payload.id}.mp4`;
  } else if (payload.t === "tb") {
    const dl = await getTeraBoxDownload(env, payload.share, payload.fsId);
    url = dl.url;
    headers = { "User-Agent": TB_UA, Referer: "https://www.terabox.com/" };
    filename = dl.filename || filename;
  } else {
    url = payload.url;
    headers = { "User-Agent": DEFAULT_UA, ...(payload.headers ?? {}) };
  }

  if (range) headers.Range = range;

  const response = await fetch(url, { headers, redirect: "follow" });
  const size = Number(response.headers.get("content-length") || 0) || undefined;
  const contentType = response.headers.get("content-type") || "application/octet-stream";

  return { response, filename, size, contentType };
}
