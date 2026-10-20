export type MediaKind = "video" | "audio" | "photo" | "document";

export interface Media {
  kind: MediaKind;
  url: string;
  filename: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  title?: string;
  performer?: string;
  headers?: Record<string, string>;
  /** Re-resolved from YouTube at download time (URLs expire). */
  yt?: { id: string; itag: number };
  /** Re-resolved from TeraBox at download time (URLs expire). */
  tb?: { share: string; fsId: string };
}

export type Platform = "tiktok" | "instagram" | "facebook" | "youtube" | "terabox";

export interface ExtractResult {
  platform: Platform;
  title: string;
  caption: string;
  cover?: string;
  /** Primary media. For carousels this is every item. */
  medias: Media[];
  /** Alternative downloads (e.g. audio-only track). */
  extras: Media[];
  sourceUrl: string;
}

export function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 2)} ${units[i]}`;
}

export function humanDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "-";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
