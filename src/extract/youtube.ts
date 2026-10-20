import type { Env } from "../env";
import type { ExtractResult, Media } from "./types";

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3)";
const CLIENT = { clientName: "ANDROID_VR", clientVersion: "1.60.19", hl: "en", gl: "US" };

export function parseYouTubeId(input: string): string | null {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/")[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export interface YtFormat {
  itag: number;
  mime: string;
  size?: number;
  url: string;
  quality?: string;
  bitrate?: number;
}

export interface YtInfo {
  id: string;
  title: string;
  author: string;
  duration?: number;
  thumb?: string;
  video?: YtFormat;
  audio?: YtFormat;
  videoAlternatives: YtFormat[];
}

interface RawFormat {
  itag: number;
  mimeType?: string;
  url?: string;
  contentLength?: string;
  qualityLabel?: string;
  audioQuality?: string;
  bitrate?: number;
}

async function fetchPlayer(id: string): Promise<any> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": VR_UA,
      "X-YouTube-Client-Name": "28",
      "X-YouTube-Client-Version": "1.60.19",
    },
    body: JSON.stringify({
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
      context: { client: CLIENT },
    }),
  });
  if (!res.ok) throw new Error(`YouTube menolak permintaan (${res.status})`);
  return res.json();
}

function toFormat(f: RawFormat): YtFormat | null {
  if (!f?.url) return null;
  return {
    itag: f.itag,
    mime: (f.mimeType || "video/mp4").split(";")[0],
    size: f.contentLength ? Number(f.contentLength) : undefined,
    url: f.url,
    quality: f.qualityLabel || f.audioQuality,
    bitrate: f.bitrate,
  };
}

export async function getYtInfo(env: Env, id: string, force = false): Promise<YtInfo> {
  const cacheKey = `yt:${id}`;
  if (!force) {
    const cached = await env.BOT_KV.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as YtInfo;
      } catch {
        /* ignore */
      }
    }
  }

  const player = await fetchPlayer(id);
  const status = player?.playabilityStatus?.status;
  if (status !== "OK") {
    const reason = player?.playabilityStatus?.reason || "Video tidak bisa diakses";
    throw new Error(`YouTube: ${reason}`);
  }

  const details = player.videoDetails ?? {};
  const streaming = player.streamingData ?? {};
  const formats: RawFormat[] = [...(streaming.formats ?? []), ...(streaming.adaptiveFormats ?? [])];

  const muxed = (streaming.formats ?? []) as RawFormat[];
  const adaptive = (streaming.adaptiveFormats ?? []) as RawFormat[];

  const videoCandidates = muxed
    .filter((f) => f.url && (f.mimeType || "").startsWith("video/mp4"))
    .map(toFormat)
    .filter((f): f is YtFormat => Boolean(f))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  const audioCandidates = adaptive
    .filter((f) => f.url && (f.mimeType || "").startsWith("audio/mp4"))
    .map(toFormat)
    .filter((f): f is YtFormat => Boolean(f))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  const video = videoCandidates[0];
  const audio = audioCandidates[0];

  if (!video && !audio) throw new Error("YouTube tidak mengembalikan stream yang bisa dipakai.");

  const thumbs = details.thumbnail?.thumbnails ?? [];
  const duration = details.lengthSeconds ? Number(details.lengthSeconds) : undefined;
  // Some muxed formats do not expose contentLength; estimate it from the bitrate.
  if (video && !video.size && video.bitrate && duration) {
    video.size = Math.round((video.bitrate * duration) / 8);
  }
  if (audio && !audio.size && audio.bitrate && duration) {
    audio.size = Math.round((audio.bitrate * duration) / 8);
  }

  const info: YtInfo = {
    id,
    title: details.title || "YouTube video",
    author: details.author || "",
    duration,
    thumb: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    video,
    audio,
    videoAlternatives: videoCandidates,
  };

  await env.BOT_KV.put(cacheKey, JSON.stringify(info), { expirationTtl: 1200 });
  // Touch the local variable to keep the linter quiet about `formats`.
  void formats;
  return info;
}

export async function extractYouTube(env: Env, url: string): Promise<ExtractResult> {
  const id = parseYouTubeId(url);
  if (!id) throw new Error("Link YouTube tidak valid.");

  const info = await getYtInfo(env, id);
  const medias: Media[] = [];
  const extras: Media[] = [];

  if (info.video) {
    medias.push({
      kind: "video",
      url: info.video.url,
      filename: `${safeName(info.title)}.mp4`,
      size: info.video.size,
      duration: info.duration,
      width: 640,
      height: 360,
      title: info.title,
      headers: { "User-Agent": VR_UA },
      yt: { id, itag: info.video.itag },
    });
  }
  if (info.audio) {
    extras.push({
      kind: "audio",
      url: info.audio.url,
      filename: `${safeName(info.title)}.m4a`,
      size: info.audio.size,
      duration: info.duration,
      title: info.title,
      performer: info.author,
      headers: { "User-Agent": VR_UA },
      yt: { id, itag: info.audio.itag },
    });
  }

  const caption = `<b>${escapeHtml(info.title)}</b>\n${escapeHtml(info.author)}`;
  return {
    platform: "youtube",
    title: info.title,
    caption,
    cover: info.thumb,
    medias,
    extras,
    sourceUrl: url,
  };
}

export async function resolveYtStream(env: Env, id: string, itag: number): Promise<{ url: string; mime: string; size?: number }> {
  for (const force of [false, true]) {
    const info = await getYtInfo(env, id, force);
    const all = [info.video, info.audio, ...info.videoAlternatives].filter(Boolean) as YtFormat[];
    const hit = all.find((f) => f.itag === itag);
    if (hit) return { url: hit.url, mime: hit.mime, size: hit.size };
  }
  throw new Error("Stream YouTube tidak tersedia lagi, coba ulang.");
}

export function safeName(name: string): string {
  return (name || "youtube")
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70) || "youtube";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
