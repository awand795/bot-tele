export const WIB_OFFSET = 7 * 3600 * 1000;

export function wibNow(now = Date.now()): Date {
  return new Date(now + WIB_OFFSET);
}

export function wibDay(now = Date.now()): string {
  const d = wibNow(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatWib(ts: number): string {
  const d = new Date(ts + WIB_OFFSET);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm} WIB`;
}

export function formatWibShort(ts: number): string {
  const d = new Date(ts + WIB_OFFSET);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Parse "HH:MM text" or "YYYY-MM-DD HH:MM text" as Asia/Jakarta time.
 */
export function parseReminder(input: string, now = Date.now()): { dueAt: number; text: string } | null {
  const full = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+([\s\S]+)$/);
  if (full) {
    const [, ys, ms, ds, hs, mins, text] = full;
    const dueAt = Date.UTC(Number(ys), Number(ms) - 1, Number(ds), Number(hs), Number(mins)) - WIB_OFFSET;
    if (!Number.isFinite(dueAt) || dueAt <= now) return null;
    return { dueAt, text: text.trim() };
  }

  const short = input.match(/^(\d{1,2}):(\d{2})\s+([\s\S]+)$/);
  if (short) {
    const [, hs, mins, text] = short;
    const wib = wibNow(now);
    const y = wib.getUTCFullYear();
    const m = wib.getUTCMonth();
    const d = wib.getUTCDate();
    let dueAt = Date.UTC(y, m, d, Number(hs), Number(mins)) - WIB_OFFSET;
    if (dueAt <= now + 15_000) dueAt += 24 * 3600 * 1000;
    return { dueAt, text: text.trim() };
  }

  return null;
}
