import type { Env } from "../env";
import type { ExtractResult, Media } from "./types";

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3)";

interface InnertubeClient {
  name: string;
  ua: string;
  /** X-YouTube-Client-Name */
  id: string;
  version: string;
  context: Record<string, unknown>;
}

/**
 * YouTube memblokir sebagian IP dengan `LOGIN_REQUIRED` per client. VR biasanya
 * paling longgar, IOS dipakai sebagai cadangan ketika VR kena "not a bot".
 */
const CLIENTS: InnertubeClient[] = [
  {
    name: "ANDROID_VR",
    ua: VR_UA,
    id: "28",
    version: "1.60.19",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.60.19",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12",
      hl: "en",
      gl: "US",
    },
  },
  {
    name: "IOS",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    id: "5",
    version: "20.10.4",
    context: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "en",
      gl: "US",
    },
  },
];

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
  width?: number;
  height?: number;
}

export interface YtInfo {
  id: string;
  title: string;
  author: string;
  duration?: number;
  thumb?: string;
  /** Progressive stream (video + audio in one file). YouTube only serves 360p this way. */
  video?: YtFormat;
  audio?: YtFormat;
  /** Adaptive video-only streams at 720p/1080p. No audio track. */
  videoOnly?: YtFormat[];
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
  width?: number;
  height?: number;
}

async function fetchPlayer(id: string, client: InnertubeClient, cookie?: string): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": client.ua,
    "X-YouTube-Client-Name": client.id,
    "X-YouTube-Client-Version": client.version,
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
      context: { client: client.context },
    }),
  });
  if (!res.ok) throw new Error(`YouTube menolak permintaan (${res.status})`);
  return res.json();
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

/** Video harus punya URL langsung; format yang hanya berisi audio tidak cukup. */
function hasPlayableVideo(player: any): boolean {
  const all: RawFormat[] = [
    ...(player?.streamingData?.formats ?? []),
    ...(player?.streamingData?.adaptiveFormats ?? []),
  ];
  return all.some((f) => Boolean(f?.url) && (f.mimeType || "").startsWith("video/"));
}

/** Cari objek JSON seimbang mulai dari `start` (kurung kurawal pertama). */
function balancedJson(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Ambil satu objek JSON kecil (`"key":{...}`) tanpa parse seluruh halaman. */
function smallObject(html: string, key: string): any | null {
  const at = html.indexOf(`"${key}":`);
  if (at === -1) return null;
  const start = html.indexOf("{", at + key.length + 3);
  if (start === -1) return null;
  const end = balancedJson(html, start);
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Rakit player response dari potongan-potongan yang dibutuhkan saja. */
function readPlayer(html: string): any | null {
  const streamingData = smallObject(html, "streamingData");
  if (!streamingData) return null;

  return {
    playabilityStatus: smallObject(html, "playabilityStatus") ?? { status: "OK" },
    videoDetails: smallObject(html, "videoDetails") ?? {},
    streamingData,
  };
}

/**
 * Ambil player data lewat proxy Google Translate. Permintaan player datang dari
 * IP proxy, sehingga lolos bot-check, dan URL media terkunci ke IP peminta
 * (Worker) — jadi tetap bisa di-stream sendiri. Halaman mobile dipakai lebih dulu
 * karena setengah ukuran desktop; CPU free plan hanya 10 ms.
 */
async function fetchPlayerViaTranslate(id: string): Promise<any | null> {
  const attempts = [
    { host: "m-youtube-com.translate.goog", ua: MOBILE_UA },
    { host: "www-youtube-com.translate.goog", ua: DESKTOP_UA },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(
        `https://${attempt.host}/watch?v=${id}&_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp`,
        { headers: { "User-Agent": attempt.ua, "Accept-Language": "en-US,en;q=0.9" } },
      );
      if (!res.ok) continue;

      const player = readPlayer(await res.text());
      if (player?.playabilityStatus?.status === "OK" && hasPlayableVideo(player)) return player;
      console.warn("yt translate empty", attempt.host, player?.playabilityStatus?.status);
    } catch {
      /* coba host berikutnya */
    }
  }
  return null;
}

/** Ambil player response dari client pertama yang diterima YouTube. */
async function fetchPlayable(id: string, cookie?: string): Promise<any> {
  const failures: string[] = [];

  for (const client of CLIENTS) {
    try {
      const player = await fetchPlayer(id, client, cookie);
      if (player?.playabilityStatus?.status === "OK" && hasPlayableVideo(player)) return player;
      console.warn("yt client", client.name, player?.playabilityStatus?.status, hasPlayableVideo(player));
      failures.push(player?.playabilityStatus?.reason || player?.playabilityStatus?.status || "tidak bisa diakses");
    } catch (err) {
      failures.push((err as Error).message);
    }
  }

  const smuggled = await fetchPlayerViaTranslate(id);
  if (smuggled) return smuggled;

  const reason = failures[0] ?? "video tidak bisa diakses";
  if (failures.every((f) => /not a bot|LOGIN_REQUIRED|sign in/i.test(f))) {
    throw new Error("YouTube membatasi permintaan dari server ini. Coba lagi beberapa saat atau pakai link lain.");
  }
  throw new Error(`YouTube: ${reason}`);
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
    width: f.width,
    height: f.height,
  };
}

/**
 * Adaptive (video-only) streams, one per resolution, preferring H.264 so every
 * Telegram client can play it. YouTube does not mux these with audio, and the
 * free plan cannot run ffmpeg, so they are delivered as-is.
 */
function collectVideoOnly(adaptive: RawFormat[]): YtFormat[] {
  const picked = new Map<number, { fmt: YtFormat; avc: boolean }>();

  for (const f of adaptive) {
    const mime = f.mimeType || "";
    if (!f.url || !mime.startsWith("video/mp4")) continue;
    const height = f.height || Number((f.qualityLabel || "").replace(/p.*$/, ""));
    if (!height || height < 144 || height > 2160) continue;

    const fmt = toFormat(f);
    if (!fmt) continue;
    fmt.height = height;

    const avc = /avc1/i.test(mime);
    const prev = picked.get(height);
    const better =
      !prev ||
      (avc && !prev.avc) ||
      (avc === prev.avc && (fmt.size ?? 0) > (prev.fmt.size ?? 0));
    if (better) picked.set(height, { fmt, avc });
  }

  return [...picked.values()]
    .map((v) => v.fmt)
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
}

export async function getYtInfo(env: Env, id: string, force = false): Promise<YtInfo> {
  const cacheKey = `yt:${id}`;
  if (!force) {
    const cached = await env.BOT_KV.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as YtInfo;
        // Cache dari percobaan lama bisa hanya berisi audio; anggap tidak ada.
        if (parsed.video || (parsed.videoOnly && parsed.videoOnly.length)) return parsed;
      } catch {
        /* ignore */
      }
    }
  }

  // Saat refresh paksa, jangan buang format yang masih ada di cache: jalur tertentu
  // (mis. lewat proxy) bisa hanya mengembalikan video tanpa audio.
  let previous: YtInfo | null = null;
  if (force) {
    try {
      const raw = await env.BOT_KV.get(cacheKey);
      if (raw) previous = JSON.parse(raw) as YtInfo;
    } catch {
      /* ignore */
    }
  }

  const player = await fetchPlayable(id, env.YOUTUBE_COOKIE?.trim() || undefined);
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
  const videoOnly = collectVideoOnly(adaptive);

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
  for (const f of videoOnly) {
    if (!f.size && f.bitrate && duration) f.size = Math.round((f.bitrate * duration) / 8);
  }

  const info: YtInfo = {
    id,
    title: details.title || "YouTube video",
    author: details.author || "",
    duration,
    thumb: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    video,
    audio,
    videoOnly,
    videoAlternatives: [...videoCandidates, ...videoOnly],
  };

  if (previous) {
    info.video = info.video ?? previous.video;
    info.audio = info.audio ?? previous.audio;
    if (!info.videoOnly?.length) info.videoOnly = previous.videoOnly ?? [];
    info.videoAlternatives = [...(info.videoAlternatives ?? []), ...(previous.videoAlternatives ?? [])];
  }

  await env.BOT_KV.put(cacheKey, JSON.stringify(info), { expirationTtl: 1200 });
  // Touch the local variable to keep the linter quiet about `formats`.
  void formats;
  return info;
}

/** Kalau tidak ada stream muxed, pakai adaptive yang paling dekat 360p. */
function pickPrimaryVideo(list: YtFormat[]): YtFormat | undefined {
  if (!list.length) return undefined;
  return [...list].sort(
    (a, b) => Math.abs((a.height ?? 360) - 360) - Math.abs((b.height ?? 360) - 360),
  )[0];
}

export async function extractYouTube(env: Env, url: string): Promise<ExtractResult> {
  const id = parseYouTubeId(url);
  if (!id) throw new Error("Link YouTube tidak valid.");

  const info = await getYtInfo(env, id);
  const medias: Media[] = [];
  const extras: Media[] = [];

  // Sejak bot-check meluas, YouTube kadang hanya memberi format adaptive (tanpa
  // muxed). Tetap kirim video supaya user tidak berakhir dengan error kosong.
  const primary = info.video ?? pickPrimaryVideo(info.videoOnly ?? []);
  if (primary) {
    medias.push({
      kind: "video",
      url: primary.url,
      filename: `${safeName(info.title)}.mp4`,
      size: primary.size,
      duration: info.duration,
      width: primary.width ?? 640,
      height: primary.height ?? 360,
      title: info.title,
      headers: { "User-Agent": VR_UA },
      yt: { id, itag: primary.itag },
      silent: !info.video,
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

  for (const f of info.videoOnly ?? []) {
    const height = f.height ?? 0;
    if (height < 720 || height > 1080) continue;
    if (primary && f.itag === primary.itag) continue;
    extras.push({
      kind: "video",
      url: f.url,
      filename: `${safeName(info.title)}_${height}p.mp4`,
      size: f.size,
      duration: info.duration,
      width: f.width ?? (height === 1080 ? 1920 : 1280),
      height,
      title: `${info.title} (${height}p, tanpa suara)`,
      headers: { "User-Agent": VR_UA },
      yt: { id, itag: f.itag },
    });
  }

  const silentNote = info.video
    ? ""
    : "\n<i>Video ini dikirim tanpa suara; audio tersedia terpisah.</i>";
  const caption = `<b>${escapeHtml(info.title)}</b>\n${escapeHtml(info.author)}${silentNote}`;
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

export async function resolveYtStream(
  env: Env,
  id: string,
  itag: number,
  force = false,
): Promise<{ url: string; mime: string; size?: number }> {
  for (const attempt of force ? [true] : [false, true]) {
    const info = await getYtInfo(env, id, attempt);
    const all = [info.video, info.audio, ...(info.videoOnly ?? []), ...(info.videoAlternatives ?? [])].filter(
      Boolean,
    ) as YtFormat[];
    const hit = all.find((f) => f.itag === itag);
    if (hit) return { url: hit.url, mime: hit.mime, size: hit.size };
  }
  throw new Error("Stream YouTube tidak tersedia lagi, coba ulang.");
}

export interface YtSearchItem {
  id: string;
  title: string;
  author: string;
  duration?: number;
  views?: string;
  thumb?: string;
}

function parseClock(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Search YouTube through the same Innertube client used for playback. */
export async function searchYouTube(limit: number, query: string): Promise<YtSearchItem[]> {
  const client = CLIENTS[0];
  const res = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": client.ua,
      "X-YouTube-Client-Name": client.id,
      "X-YouTube-Client-Version": client.version,
    },
    body: JSON.stringify({ query, context: { client: client.context } }),
  });
  if (!res.ok) throw new Error(`YouTube search gagal (${res.status})`);

  const json: any = await res.json();
  const sections = json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const items: YtSearchItem[] = [];

  for (const section of sections) {
    const contents = section?.itemSectionRenderer?.contents ?? [];
    for (const entry of contents) {
      const video = entry?.videoRenderer;
      if (!video?.videoId) continue;
      items.push({
        id: video.videoId,
        title: video.title?.runs?.map((r: any) => r.text).join("") ?? video.title?.simpleText ?? "Video",
        author: video.ownerText?.runs?.[0]?.text ?? "",
        duration: parseClock(video.lengthText?.simpleText),
        views: video.viewCountText?.simpleText ?? video.shortViewCountText?.simpleText ?? "",
        thumb: video.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ?? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      });
      if (items.length >= limit) return items;
    }
  }
  return items;
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
