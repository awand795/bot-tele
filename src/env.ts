export interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  BOT_KV: KVNamespace;
  DB: D1Database;
  AI: Ai;
  /** Optional TeraBox account cookie. Without it TeraBox share links hit a captcha. */
  TERABOX_COOKIE?: string;
  /** Optional Instagram session cookie. Needed for reliable public media access. */
  INSTAGRAM_COOKIE?: string;
  /** Optional TikTok session cookie. Needed for reliable public media access. */
  TIKTOK_COOKIE?: string;
}

export const LIMITS = {
  /** Telegram: file max 20MB when fetched from URL */
  URL_MAX: 20 * 1024 * 1024,
  /** Telegram: file max 50MB when uploaded by bot. Keep margin for multipart. */
  UPLOAD_MAX: 45 * 1024 * 1024,
  /** Rate limit per user per hour for downloads */
  RATE_PER_HOUR: 12,
  /** AI requests per user per day */
  AI_PER_DAY: 20,
  /** How long signed download links stay valid */
  LINK_TTL: 2 * 60 * 60,
};
