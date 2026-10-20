import type { Env } from "../env";
import type { ExtractResult, Media } from "./types";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const APP_UA = "Instagram 219.0.0.12.117 Android (33/13; 420dpi; 1080x2400; samsung; SM-S911B; dm3q; qcom; en_US)";

const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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

/** Instagram shortcodes are base64-ish encodings of the numeric media id. */
export function shortcodeToMediaId(code: string): string | null {
  if (!code) return null;
  let id = 0n;
  for (const char of code) {
    const value = SHORTCODE_ALPHABET.indexOf(char);
    if (value < 0) return null;
    id = id * 64n + BigInt(value);
  }
  return id.toString();
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

function cookieValue(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

interface IgItem {
  media_type?: number;
  video_versions?: Array<{ url: string; width?: number; height?: number }>;
  image_versions2?: { candidates?: Array<{ url: string; width?: number; height?: number }> };
  carousel_media?: IgItem[];
  caption?: { text?: string };
  code?: string;
}

function instagramHeaders(env: Env, code: string, app: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": app ? APP_UA : WEB_UA,
    Accept: app ? "*/*" : "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `https://www.instagram.com/p/${code}/`,
  };

  if (app) {
    headers["x-ig-app-id"] = "1217981644879628";
    headers["X-IG-Capabilities"] = "3brTvw==";
    headers["X-IG-Connection-Type"] = "WIFI";
  } else {
    headers["x-ig-app-id"] = "936619743392459";
    headers["x-ig-www-claim"] = "0";
    headers["x-asbd-id"] = "129477";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }

  const cookie = env.INSTAGRAM_COOKIE?.trim();
  if (cookie) {
    headers.Cookie = cookie;
    const csrf = cookieValue(cookie, "csrftoken");
    if (csrf) headers["x-csrftoken"] = csrf;
  }

  return headers;
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

async function fetchInfo(env: Env, code: string, app: boolean): Promise<IgItem[]> {
  const mediaId = shortcodeToMediaId(code);
  if (!mediaId) throw new Error("Shortcode Instagram tidak valid.");

  const host = app ? "https://i.instagram.com" : "https://www.instagram.com";
  const res = await fetch(`${host}/api/v1/media/${mediaId}/info/`, {
    headers: instagramHeaders(env, code, app),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body: any = await res.json();
      detail = body?.message || body?.error_title || "";
    } catch {
      /* body is often empty */
    }
    throw new Error(`Instagram ${app ? "app" : "web"} API HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Instagram ${app ? "app" : "web"} API tidak mengembalikan JSON.`);
  }

  const json: any = await res.json().catch(() => null);
  if (!json?.items?.length) throw new Error("Instagram tidak mengembalikan media.");
  return json.items as IgItem[];
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

export async function extractInstagram(env: Env, url: string): Promise<ExtractResult> {
  const code = parseInstagramCode(url);
  if (!code) throw new Error("Link Instagram tidak valid.");

  const errors: string[] = [];
  let items: IgItem[] | null = null;

  for (const attempt of [() => fetchInfo(env, code, false), () => fetchInfo(env, code, true)]) {
    try {
      items = await attempt();
      if (items.length) break;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (items?.length) {
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

  if (!env.INSTAGRAM_COOKIE?.trim()) {
    throw new Error(
      "Instagram butuh cookie sesi. Set secret INSTAGRAM_COOKIE (lihat README) lalu coba lagi.",
    );
  }

  const detail = errors.length ? ` (${errors[0]})` : "";
  throw new Error(
    `Instagram menolak permintaan${detail}. Cookie mungkin kedaluwarsa; ambil ulang cookie lalu simpan lagi.`,
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
