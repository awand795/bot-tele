import type { Env } from "./env";
import type { Media, MediaKind } from "./extract/types";
import { resolveYtStream, VR_UA } from "./extract/youtube";
import { getTeraBoxDownload, TB_UA } from "./extract/terabox";

export type StreamPayload =
  | { t: "u"; url: string; headers?: Record<string, string>; filename?: string; kind?: MediaKind }
  | { t: "yt"; id: string; itag: number; filename?: string; kind?: MediaKind }
  | { t: "tb"; share: string; fsId: string; filename?: string; kind?: MediaKind };

export function payloadForMedia(media: Media): StreamPayload {
  if (media.yt) return { t: "yt", id: media.yt.id, itag: media.yt.itag, filename: media.filename, kind: media.kind };
  if (media.tb) return { t: "tb", share: media.tb.share, fsId: media.tb.fsId, filename: media.filename, kind: media.kind };
  return { t: "u", url: media.url, headers: media.headers, filename: media.filename, kind: media.kind };
}

/** Raised when the upstream source answers with an error page instead of media. */
export class MediaFetchError extends Error {
  status?: number;
  contentType: string;

  constructor(message: string, status?: number, contentType = "") {
    super(message);
    this.name = "MediaFetchError";
    this.status = status;
    this.contentType = contentType;
  }
}

const TEXT_CONTENT =
  /^(text\/|application\/(?:json|xml|xhtml\+xml|problem\+json|javascript))/i;

/**
 * Guard against uploading HTML/JSON error pages as media.
 * Unknown/octet-stream content is allowed so streams without a useful
 * content-type still work.
 */
export function isMediaContentType(kind: MediaKind | undefined, contentType: string): boolean {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if (!type || type === "application/octet-stream") return true;
  if (TEXT_CONTENT.test(type)) return false;

  switch (kind) {
    case "video":
      return type.startsWith("video/");
    case "audio":
      return type.startsWith("audio/") || type === "video/mp4";
    case "photo":
      return type.startsWith("image/");
    case "document":
      return !type.startsWith("text/");
    default:
      return true;
  }
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
