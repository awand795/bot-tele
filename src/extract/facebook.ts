import type { ExtractResult, Media } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

function unescapeUrl(raw: string): string {
  return raw
    .replace(/\\u0025/gi, "%")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

async function resolveRedirects(input: string): Promise<string> {
  let current = input;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(current, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (!location) return current;
    current = new URL(location, current).toString();
    if (!/fb\.watch|facebook\.com\/share/i.test(current)) return current;
  }
  return current;
}

function pickVideoUrl(html: string): string | null {
  const patterns = [
    /"hd_src":"([^"]+)"\s*,\s*"sd_src"/,
    /"sd_src":"([^"]+)"/,
    /"hd_src":"([^"]+)"/,
    /"playable_url_quality_hd":"([^"]+)"/,
    /"playable_url":"([^"]+)"/,
    /"browser_native_hd_url":"([^"]+)"/,
    /"browser_native_sd_url":"([^"]+)"/,
    /hd_src:"([^"]+)"/,
    /sd_src:"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const url = unescapeUrl(m[1]);
      if (/^https?:\/\//.test(url)) return url;
    }
  }
  const meta = html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/);
  if (meta?.[1]) return unescapeUrl(meta[1]);
  return null;
}

function pickTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)?.[1];
  if (og) return og.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1];
  return t?.trim();
}

export async function extractFacebook(url: string): Promise<ExtractResult> {
  const resolved = await resolveRedirects(url);
  const candidates = new Set<string>();

  // 1. Official embed plugin (most reliable, no login)
  const plugin = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(resolved)}&show_text=false&autoplay=1`;
  const pluginRes = await fetch(plugin, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
  }).catch(() => null);

  let html = "";
  if (pluginRes?.ok) {
    html = await pluginRes.text();
    const v = pickVideoUrl(html);
    if (v) candidates.add(v);
  }

  // 2. Direct page / embed endpoint fallback
  if (candidates.size === 0) {
    const id = resolved.match(/\/(?:videos|reel)\/(\d+)/)?.[1] ?? resolved.match(/[?&]v=(\d+)/)?.[1];
    const targets = [resolved];
    if (id) {
      targets.push(`https://www.facebook.com/video/embed?video_id=${id}`);
      targets.push(`https://www.facebook.com/videos/${id}/`);
    }
    for (const target of targets) {
      try {
        const res = await fetch(target, {
          headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml",
            Cookie: "locale=en_US",
          },
        });
        if (!res.ok) continue;
        const body = await res.text();
        if (!html) html = body;
        const v = pickVideoUrl(body);
        if (v) {
          candidates.add(v);
          break;
        }
      } catch {
        /* try next */
      }
    }
  }

  const videoUrl = [...candidates][0];
  if (!videoUrl) {
    throw new Error(
      "Video Facebook tidak bisa diambil. Pastikan postingan publik dan bukan link story/profil.",
    );
  }

  const title = pickTitle(html) || "Facebook video";
  const medias: Media[] = [
    {
      kind: "video",
      url: videoUrl,
      filename: `facebook_${Date.now()}.mp4`,
      title,
      headers: { Referer: "https://www.facebook.com/" },
    },
  ];

  return {
    platform: "facebook",
    title,
    caption: `<b>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b>`,
    medias,
    extras: [],
    sourceUrl: url,
  };
}
