import type { Env } from "../env";
import type { ExtractResult, Media } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

function absolute(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return "https://www.tikwm.com" + (url.startsWith("/") ? url : "/" + url);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildResult(params: {
  id: string;
  title: string;
  author: string;
  cover?: string;
  video?: { url: string; size?: number; duration?: number; width?: number; height?: number };
  images?: string[];
  music?: string;
  url: string;
}): ExtractResult {
  const medias: Media[] = [];
  const extras: Media[] = [];
  const { id, title, author } = params;

  if (params.images?.length) {
    params.images.forEach((img, i) => {
      const src = absolute(img);
      if (!src) return;
      medias.push({ kind: "photo", url: src, filename: `tiktok_${id}_${i + 1}.jpg`, title });
    });
  } else if (params.video) {
    medias.push({
      kind: "video",
      url: absolute(params.video.url)!,
      filename: `tiktok_${id}.mp4`,
      size: params.video.size,
      duration: params.video.duration,
      width: params.video.width,
      height: params.video.height,
      title,
      headers: { Referer: "https://www.tiktok.com/" },
    });
  }

  if (params.music) {
    extras.push({
      kind: "audio",
      url: absolute(params.music)!,
      filename: `tiktok_${id}_audio.mp3`,
      title,
      performer: author || "TikTok",
      headers: { Referer: "https://www.tiktok.com/" },
    });
  }

  if (!medias.length) throw new Error("Media TikTok tidak ditemukan.");

  const captionLines = [`<b>${escapeHtml(title)}</b>`];
  if (author) captionLines.push(author);

  return {
    platform: "tiktok",
    title,
    caption: captionLines.join("\n"),
    cover: params.cover ? absolute(params.cover) : undefined,
    medias,
    extras,
    sourceUrl: params.url,
  };
}

async function viaTikwm(url: string): Promise<ExtractResult> {
  const endpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const res = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": UA } });
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Tikwm tidak merespons dengan benar");
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "Tikwm gagal memproses link");
  }

  const d = json.data;
  const author: string = d.author?.unique_id ? `@${d.author.unique_id}` : d.author?.nickname ?? "";
  const description: string = (d.title || "").trim();
  const title = description || `TikTok ${author}`.trim();

  return buildResult({
    id: String(d.id ?? Date.now()),
    title,
    author,
    cover: d.cover || d.origin_cover,
    video: d.images?.length
      ? undefined
      : {
          url: d.hdplay || d.play || d.wmplay,
          size: Number(d.hd_size || d.size || 0) || undefined,
          duration: Number(d.duration) || undefined,
          width: Number(d.width) || undefined,
          height: Number(d.height) || undefined,
        },
    images: Array.isArray(d.images) && d.images.length ? d.images : undefined,
    music: d.music,
    url,
  });
}

interface TikTokItem {
  id?: string;
  desc?: string;
  author?: { uniqueId?: string; nickname?: string };
  video?: {
    playAddr?: string;
    downloadAddr?: string;
    duration?: number;
    width?: number;
    height?: number;
    cover?: string;
    dynamicCover?: string;
    bitrateInfo?: Array<{ PlayAddr?: { UrlList?: string[] } }>;
  };
  music?: { playUrl?: string; title?: string };
  imagePost?: { images?: Array<{ imageURL?: { urlList?: string[] } }> };
}

function parseVideoId(input: string): string | null {
  try {
    const u = new URL(input);
    const match = u.pathname.match(/\/(?:video|photo)\/(\d+)/);
    if (match) return match[1];
    return u.searchParams.get("item_id") || u.searchParams.get("aweme_id");
  } catch {
    return null;
  }
}

function fromItem(item: TikTokItem, url: string): ExtractResult {
  const images = item.imagePost?.images
    ?.map((img) => img.imageURL?.urlList?.[0])
    .filter((v): v is string => Boolean(v));

  const videoUrl =
    item.video?.playAddr ||
    item.video?.downloadAddr ||
    item.video?.bitrateInfo?.map((b) => b.PlayAddr?.UrlList?.[0]).find(Boolean);

  if (!images?.length && !videoUrl) throw new Error("Media TikTok tidak ditemukan.");

  const author = item.author?.uniqueId ? `@${item.author.uniqueId}` : item.author?.nickname ?? "";
  const title = (item.desc || `TikTok ${author}`).trim();

  return buildResult({
    id: String(item.id ?? Date.now()),
    title,
    author,
    cover: item.video?.dynamicCover || item.video?.cover,
    video: images?.length
      ? undefined
      : { url: videoUrl!, duration: item.video?.duration, width: item.video?.width, height: item.video?.height },
    images: images?.length ? images : undefined,
    music: item.music?.playUrl,
    url,
  });
}

function cookieHeader(env: Env): Record<string, string> {
  const cookie = env.TIKTOK_COOKIE?.trim();
  return cookie ? { Cookie: cookie } : {};
}

async function viaPage(env: Env, url: string): Promise<ExtractResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...cookieHeader(env),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`TikTok membalas ${res.status}`);
  const html = await res.text();

  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Data TikTok tidak ditemukan di halaman");

  const parsed = JSON.parse(match[1]);
  const scope = parsed?.__DEFAULT_SCOPE__ ?? {};
  const item: TikTokItem | undefined =
    scope["webapp.video-detail"]?.itemInfo?.itemStruct ??
    scope["webapp.reflow.video.detail"]?.itemInfo?.itemStruct;

  if (!item) throw new Error("Postingan TikTok tidak tersedia (mungkin privat)");
  return fromItem(item, url);
}

async function viaWebApi(env: Env, url: string): Promise<ExtractResult> {
  const id = parseVideoId(url);
  if (!id) throw new Error("ID video TikTok tidak ditemukan");

  const res = await fetch(`https://www.tiktok.com/api/item/detail/?itemId=${encodeURIComponent(id)}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: url,
      "X-Requested-With": "XMLHttpRequest",
      ...cookieHeader(env),
    },
  });
  if (!res.ok) throw new Error(`TikTok API membalas ${res.status}`);

  const json: any = await res.json().catch(() => null);
  const item: TikTokItem | undefined =
    json?.itemInfo?.itemStruct ??
    json?.itemInfo?.itemStructV2?.itemStruct ??
    json?.aweme_detail;
  if (!item) throw new Error("Data TikTok tidak ditemukan di API");
  return fromItem(item, url);
}

export async function extractTikTok(env: Env, url: string): Promise<ExtractResult> {
  const attempts: Array<(env: Env, url: string) => Promise<ExtractResult>> = [
    (_env, target) => viaTikwm(target),
    viaWebApi,
    viaPage,
  ];
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await attempt(env, url);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.some((e) => /limit|403|401|login/i.test(e))) {
    throw new Error(
      "TikTok membatasi akses server ini. Coba lagi nanti atau set TIKTOK_COOKIE (lihat README).",
    );
  }
  throw new Error(errors[0] || "Gagal mengambil media TikTok.");
}
