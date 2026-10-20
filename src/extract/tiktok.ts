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

async function viaPage(url: string): Promise<ExtractResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
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

  const images = item.imagePost?.images
    ?.map((img) => img.imageURL?.urlList?.[0])
    .filter((v): v is string => Boolean(v));

  const videoUrl =
    item.video?.playAddr ||
    item.video?.bitrateInfo?.map((b) => b.PlayAddr?.UrlList?.[0]).find(Boolean) ||
    item.video?.downloadAddr;

  const author = item.author?.uniqueId ? `@${item.author.uniqueId}` : item.author?.nickname ?? "";
  const title = (item.desc || `TikTok ${author}`).trim();

  return buildResult({
    id: String(item.id ?? Date.now()),
    title,
    author,
    cover: item.video?.dynamicCover || item.video?.cover,
    video: images?.length ? undefined : { url: videoUrl!, duration: item.video?.duration, width: item.video?.width, height: item.video?.height },
    images: images?.length ? images : undefined,
    music: item.music?.playUrl,
    url,
  });
}

export async function extractTikTok(url: string): Promise<ExtractResult> {
  const errors: string[] = [];
  for (const attempt of [viaTikwm, viaPage]) {
    try {
      return await attempt(url);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.some((e) => /limit/i.test(e))) {
    throw new Error("Server TikTok sedang sibuk (rate limit). Coba lagi 5–10 detik.");
  }
  throw new Error(errors[0] || "Gagal mengambil media TikTok.");
}
