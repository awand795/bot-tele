import type { ExtractResult, Media } from "./types";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const APP_UA = "Instagram 219.0.0.12.117 Android (33/13; 420dpi; 1080x2400; samsung; SM-S911B; dm3q; qcom; en_US)";

export function parseInstagramCode(input: string): string | null {
  try {
    const u = new URL(input);
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    return m[1];
  } catch {
    return null;
  }
}

function unescapeJsonUrl(raw: string): string {
  return raw
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/g, "?")
    .replace(/\\u0025/g, "%")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function firstUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = unescapeJsonUrl(raw);
  return /^https?:\/\//.test(value) ? value : undefined;
}

interface IgItem {
  media_type?: number;
  video_versions?: Array<{ url: string; width?: number; height?: number }>;
  image_versions2?: { candidates?: Array<{ url: string; width?: number; height?: number }> };
  carousel_media?: IgItem[];
  caption?: { text?: string };
  code?: string;
}

function buildFromItems(items: IgItem[]): { medias: Media[]; caption?: string } {
  const medias: Media[] = [];
  let caption: string | undefined;

  const push = (item: IgItem, index: number) => {
    if (!caption && item.caption?.text) caption = item.caption.text;
    if (item.media_type === 2 && item.video_versions?.length) {
      const v = item.video_versions[0];
      medias.push({
        kind: "video",
        url: v.url,
        filename: `instagram_${item.code ?? index}_${index + 1}.mp4`,
        width: v.width,
        height: v.height,
        headers: { Referer: "https://www.instagram.com/" },
      });
      return;
    }
    const img = item.image_versions2?.candidates?.[0];
    if (img?.url) {
      medias.push({
        kind: "photo",
        url: img.url,
        filename: `instagram_${item.code ?? index}_${index + 1}.jpg`,
        width: img.width,
        height: img.height,
        headers: { Referer: "https://www.instagram.com/" },
      });
    }
  };

  items.forEach((item, i) => {
    if (item.carousel_media?.length) {
      item.carousel_media.forEach((child, j) => push(child, i + j));
    } else {
      push(item, i);
    }
  });

  return { medias, caption };
}

async function tryWebApi(code: string): Promise<IgItem[] | null> {
  const res = await fetch(`https://www.instagram.com/api/v1/media/${code}/info/`, {
    headers: {
      "User-Agent": WEB_UA,
      Accept: "*/*",
      "x-ig-app-id": "936619743392459",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `https://www.instagram.com/p/${code}/`,
    },
  });
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => null);
  return json?.items?.length ? (json.items as IgItem[]) : null;
}

async function tryAppApi(code: string): Promise<IgItem[] | null> {
  const res = await fetch(`https://i.instagram.com/api/v1/media/${code}/info/`, {
    headers: {
      "User-Agent": APP_UA,
      Accept: "*/*",
      "x-ig-app-id": "1217981644879628",
      "Accept-Language": "en-US",
    },
  });
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => null);
  if (json?.items?.length) return json.items as IgItem[];
  return null;
}

async function tryEmbed(code: string): Promise<{ medias: Media[]; caption?: string; title?: string } | null> {
  const res = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
    headers: { "User-Agent": WEB_UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const medias: Media[] = [];

  const video =
    firstUrl(html.match(/"video_url":"([^"]+)"/)?.[1]) ||
    firstUrl(html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/)?.[1]) ||
    firstUrl(html.match(/"contentUrl":"([^"]+)"/)?.[1]);

  const image =
    firstUrl(html.match(/"display_url":"([^"]+)"/)?.[1]) ||
    firstUrl(html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)?.[1]);

  if (video) {
    medias.push({
      kind: "video",
      url: video,
      filename: `instagram_${code}.mp4`,
      headers: { Referer: "https://www.instagram.com/" },
    });
  } else if (image) {
    medias.push({
      kind: "photo",
      url: image,
      filename: `instagram_${code}.jpg`,
      headers: { Referer: "https://www.instagram.com/" },
    });
  }

  const captionRaw = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const title = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)?.[1];
  const caption = captionRaw
    ? captionRaw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&#\d+;/g, " ").trim()
    : undefined;

  if (!medias.length) return null;
  return { medias, caption, title };
}

export async function extractInstagram(url: string): Promise<ExtractResult> {
  const code = parseInstagramCode(url);
  if (!code) throw new Error("Link Instagram tidak valid.");

  let items: IgItem[] | null = null;
  let lastError: unknown = null;

  for (const attempt of [tryWebApi, tryAppApi]) {
    try {
      items = await attempt(code);
      if (items) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (items) {
    const { medias, caption } = buildFromItems(items);
    if (medias.length) {
      const title = (caption || `Instagram ${code}`).slice(0, 120);
      return {
        platform: "instagram",
        title,
        caption: `<b>${escapeHtml(title)}</b>`,
        cover: medias[0]?.kind === "photo" ? medias[0].url : undefined,
        medias,
        extras: [],
        sourceUrl: url,
      };
    }
  }

  const embed = await tryEmbed(code).catch(() => null);
  if (embed) {
    const title = (embed.caption || embed.title || `Instagram ${code}`).slice(0, 120);
    return {
      platform: "instagram",
      title,
      caption: `<b>${escapeHtml(title)}</b>`,
      medias: embed.medias,
      extras: [],
      sourceUrl: url,
    };
  }

  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(
    `Instagram menolak permintaan${detail}. Biasanya karena rate limit/platform. Coba lagi beberapa saat atau pakai link lain.`,
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
