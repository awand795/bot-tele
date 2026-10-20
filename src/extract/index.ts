import type { Env } from "../env";
import type { ExtractResult, Platform } from "./types";
import { extractTikTok } from "./tiktok";
import { extractInstagram } from "./instagram";
import { extractFacebook } from "./facebook";
import { extractYouTube } from "./youtube";
import { isTeraboxUrl } from "./terabox";

export type SupportedPlatform = Exclude<Platform, "terabox">;

export function detectPlatform(input: string): Platform | null {
  const text = input.trim();
  if (isTeraboxUrl(text)) return "terabox";
  let host: string;
  try {
    host = new URL(text).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)(instagram\.com|instagr\.am|ddinstagram\.com)$/.test(host)) return "instagram";
  if (/(^|\.)(facebook\.com|fb\.watch|fb\.com|fb\.me)$/.test(host)) return "facebook";
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return "youtube";
  return null;
}

export function normalizeUrl(input: string): string {
  return input.trim().replace(/^ddinstagram\.com/i, "instagram.com").replace(/\s+$/, "");
}

export async function extractMedia(env: Env, input: string): Promise<ExtractResult> {
  const url = normalizeUrl(input);
  const platform = detectPlatform(url);
  switch (platform) {
    case "tiktok":
      return extractTikTok(env, url);
    case "instagram":
      return extractInstagram(env, url);
    case "facebook":
      return extractFacebook(url);
    case "youtube":
      return extractYouTube(env, url);
    default:
      throw new Error("Platform belum didukung. Kirim link TikTok, Instagram, Facebook, YouTube, atau TeraBox.");
  }
}

export * from "./types";
