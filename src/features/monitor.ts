import type { Ctx } from "./context";
import { qAll, qFirst, qRun } from "../db";
import type { Env } from "../env";
import { editMessage, esc, sendMessage } from "../telegram";
import { getSetting } from "../users";
import { formatWib } from "../time";

export type MonitorStatus = "up" | "protected" | "down";
export type IntervalKind = "monitor" | "rss" | "alert";

interface FeedRow {
  id: number;
  user_id: number;
  chat_id: number;
  url: string;
  title: string | null;
  last_seen: string | null;
  last_checked: number | null;
  interval_min: number;
}
interface MonitorRow {
  id: number;
  user_id: number;
  chat_id: number;
  url: string;
  status: string | null;
  last_checked: number | null;
  interval_min: number;
  paused: number;
}
interface AlertRow {
  id: number;
  user_id: number;
  chat_id: number;
  symbol: string;
  op: string;
  target: number;
  interval_min: number;
  last_checked: number | null;
}

export interface ProbeResult {
  status: MonitorStatus;
  code: number;
  ms: number;
  via?: string;
  note?: string;
}

const FEED_UA = "Mozilla/5.0 (compatible; AdnawaaBot/1.0; +https://github.com/awand795/bot-tele)";
const API_UA = "AdnawaaBot/1.0 (+https://github.com/awand795/bot-tele)";

const INTERVAL_DEFAULTS: Record<IntervalKind, number> = { monitor: 5, rss: 10, alert: 15 };
const INTERVAL_LIMITS: Record<IntervalKind, [number, number]> = {
  monitor: [1, 1440],
  rss: [5, 1440],
  alert: [5, 1440],
};

export async function getIntervalDefault(env: Env, kind: IntervalKind): Promise<number> {
  const raw = await getSetting(env, `interval_${kind}`);
  const value = Number(raw);
  const [min, max] = INTERVAL_LIMITS[kind];
  if (Number.isFinite(value) && value >= min) return Math.min(value, max);
  return INTERVAL_DEFAULTS[kind];
}

export function validateInterval(kind: IntervalKind, value: number): number | null {
  const [min, max] = INTERVAL_LIMITS[kind];
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return Math.round(value);
}

export function intervalRange(kind: IntervalKind): string {
  const [min, max] = INTERVAL_LIMITS[kind];
  return `${min}–${max} menit`;
}

function statusIcon(status: string | null | undefined): string {
  if (status === "up") return "🟢";
  if (status === "protected") return "🟡";
  return "🔴";
}

function statusLabel(status: string | null | undefined): string {
  if (status === "up") return "online";
  if (status === "protected") return "terproteksi";
  return "down";
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`.slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

/* -------------------------------- RSS -------------------------------- */

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tagValue(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeEntities(match[1]).replace(/<[^>]+>/g, "").trim() : "";
}

function atomLink(xml: string): string {
  const match = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return match ? match[1] : "";
}

function parseFeed(xml: string): { title: string; items: Array<{ id: string; title: string; link: string }> } {
  const feedTitle = tagValue(xml, "title");
  const raw = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]).slice(0, 15);
  const items = raw.map((block) => {
    const title = tagValue(block, "title") || "(tanpa judul)";
    const link = tagValue(block, "link") || atomLink(block);
    const id = tagValue(block, "guid") || tagValue(block, "id") || link || title;
    return { id, title, link };
  });
  return { title: feedTitle, items };
}

async function fetchFeed(url: string): Promise<{ title: string; items: Array<{ id: string; title: string; link: string }> }> {
  const res = await fetch(url, {
    headers: { "user-agent": FEED_UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Feed membalas ${res.status}`);
  const xml = await res.text();
  if (xml.length > 2_000_000) throw new Error("Feed terlalu besar");
  const parsed = parseFeed(xml);
  if (!parsed.items.length) throw new Error("Tidak ada item di feed ini");
  return parsed;
}

function splitUrlInterval(args: string[]): { url: string; intervalRaw: string | null } {
  const rest = [...args];
  let intervalRaw: string | null = null;
  if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) {
    intervalRaw = rest.pop()!;
  }
  return { url: rest.join(" ").trim(), intervalRaw };
}

export async function addRss(env: Env, userId: number, chatId: number, url: string, intervalArg?: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    await sendMessage(
      env,
      chatId,
      "❌ Kirim URL feed yang valid. Contoh:\n<code>/rss add https://hnrss.org/frontpage</code>",
    );
    return;
  }

  let interval = await getIntervalDefault(env, "rss");
  if (intervalArg) {
    const parsed = validateInterval("rss", Number(intervalArg));
    if (parsed === null) {
      await sendMessage(env, chatId, `❌ Interval RSS harus ${intervalRange("rss")}.`);
      return;
    }
    interval = parsed;
  }

  const count = await qFirst<{ n: number }>(env, "SELECT COUNT(*) AS n FROM feeds WHERE user_id = ?", userId);
  if ((count?.n ?? 0) >= 5) {
    await sendMessage(env, chatId, "❌ Maksimal 5 feed per user. Hapus dulu dengan /rss del &lt;id&gt;.");
    return;
  }

  let feed: Awaited<ReturnType<typeof fetchFeed>>;
  try {
    feed = await fetchFeed(url);
  } catch (err) {
    await sendMessage(env, chatId, `❌ Feed tidak bisa dibaca: ${esc((err as Error).message)}`);
    return;
  }

  await qRun(
    env,
    "INSERT INTO feeds(user_id, chat_id, url, title, last_seen, last_checked, interval_min, created_at) VALUES(?,?,?,?,?,?,?,?)",
    userId,
    chatId,
    url,
    feed.title,
    feed.items[0].id,
    Date.now(),
    interval,
    Date.now(),
  );
  await sendMessage(
    env,
    chatId,
    `📡 <b>Feed ditambahkan</b>\n\n${esc(feed.title || url)}\n${esc(feed.items[0].title)}\n\n` +
      `⏱ Cek tiap <b>${interval} menit</b>.`,
  );
}

export async function cmdRss(ctx: Ctx): Promise<void> {
  const sub = (ctx.args[0] ?? "").toLowerCase();

  if (sub === "add") {
    const { url, intervalRaw } = splitUrlInterval(ctx.args.slice(1));
    return addRss(ctx.env, ctx.userId, ctx.chatId, url, intervalRaw ?? undefined);
  }

  if (sub === "every" || sub === "interval") {
    const id = Number(ctx.args[1]);
    const interval = validateInterval("rss", Number(ctx.args[2]));
    if (!Number.isFinite(id) || interval === null) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        `Contoh: <code>/rss every 3 30</code>\nInterval: ${intervalRange("rss")}.`,
      );
    }
    await qRun(ctx.env, "UPDATE feeds SET interval_min = ? WHERE id = ? AND user_id = ?", interval, id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `⏱ Feed #${id} sekarang dicek tiap <b>${interval} menit</b>.`);
  }

  if (sub === "del" || sub === "delete") {
    const id = Number(ctx.args[1]);
    if (!Number.isFinite(id)) return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/rss del 3</code>");
    await qRun(ctx.env, "DELETE FROM feeds WHERE id = ? AND user_id = ?", id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `🗑 Feed #${id} dihapus.`);
  }

  if (ctx.args.length && sub !== "list") {
    const { url, intervalRaw } = splitUrlInterval(ctx.args);
    return addRss(ctx.env, ctx.userId, ctx.chatId, url, intervalRaw ?? undefined);
  }

  const rows = await qAll<FeedRow>(ctx.env, "SELECT * FROM feeds WHERE user_id = ? ORDER BY id", ctx.userId);
  if (!rows.length) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "📡 <b>RSS Monitor</b>\n\n" +
        "Tambah: <code>/rss add https://hnrss.org/frontpage</code>\n" +
        "Dengan interval: <code>/rss add &lt;url&gt; 30</code>\n\n" +
        `<i>Default ${await getIntervalDefault(ctx.env, "rss")} menit.</i>`,
    );
    return;
  }

  const lines = ["📡 <b>Feed kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    const title = row.title || shortUrl(row.url);
    lines.push(`<b>#${row.id}</b> ${esc(title)} · tiap ${row.interval_min ?? 10}m`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `rss_del:${row.id}` }]);
  }
  lines.push("", "<i>Ubah interval: /rss every &lt;id&gt; &lt;menit&gt;</i>");
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

/* ------------------------------ uptime ------------------------------- */

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function nipUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!isIpLiteral(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}.nip.io${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function classify(code: number): MonitorStatus {
  if (code >= 200 && code < 400) return "up";
  if (code === 401 || code === 403 || code === 429) return "protected";
  return "down";
}

async function fetchStatus(url: string, timeout = 12_000): Promise<{ status: number; ms: number; body: string }> {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": FEED_UA },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  const ms = Date.now() - started;
  let body = "";
  if (res.status === 403) body = (await res.text().catch(() => "")).slice(0, 300);
  return { status: res.status, ms, body };
}

export async function probe(url: string): Promise<ProbeResult> {
  try {
    const first = await fetchStatus(url);
    let result = first;
    let via: string | undefined;
    let note: string | undefined;

    if (first.status === 403 && first.body.includes("1003")) {
      const alt = nipUrl(url);
      if (alt) {
        try {
          const second = await fetchStatus(alt);
          if (!(second.status === 403 && second.body.includes("1003"))) {
            result = second;
            via = alt;
          } else {
            note = "Cloudflare menolak akses langsung (1003). Coba pakai hostname/domain, bukan IP.";
          }
        } catch {
          note = "Cloudflare menolak akses langsung (1003). Coba pakai hostname/domain, bukan IP.";
        }
      } else {
        note = "Cloudflare menolak akses langsung (1003).";
      }
    }

    if (result.status === 403 && result.body.includes("1003")) {
      return { status: "down", code: 403, ms: result.ms, via, note };
    }

    return { status: classify(result.status), code: result.status, ms: result.ms, via, note };
  } catch {
    return { status: "down", code: 0, ms: 0 };
  }
}

function monitorStatusLine(row: MonitorRow, result?: ProbeResult): string {
  const status = result?.status ?? row.status;
  const code = result?.code;
  const ms = result?.ms;
  return `${statusIcon(status)} <b>${statusLabel(status)}</b>${code ? ` (${code})` : ""}${ms ? ` · ${ms} ms` : ""}`;
}

function monitorDetailText(row: MonitorRow, result?: ProbeResult): string {
  const lines = [
    `📈 <b>Monitor #${row.id}</b>`,
    esc(row.url),
    "",
    `Status: ${monitorStatusLine(row, result)}`,
    `Cek terakhir: ${row.last_checked ? formatWib(row.last_checked) : "belum pernah"}`,
    `Interval: <b>${row.interval_min ?? 5} menit</b>`,
    `Keadaan: <b>${row.paused ? "⏸ dijeda" : "▶️ aktif"}</b>`,
  ];
  if (result?.via) lines.push(`Via: ${esc(result.via)}`);
  if (result?.note) lines.push(`\n⚠️ ${esc(result.note)}`);
  return lines.join("\n");
}

function monitorDetailKeyboard(row: MonitorRow): any {
  return {
    inline_keyboard: [
      [{ text: "🔄 Cek Sekarang", callback_data: `mon_check:${row.id}` }],
      [
        { text: "1m", callback_data: `mon_every:${row.id}:1` },
        { text: "5m", callback_data: `mon_every:${row.id}:5` },
        { text: "15m", callback_data: `mon_every:${row.id}:15` },
        { text: "60m", callback_data: `mon_every:${row.id}:60` },
      ],
      [
        {
          text: row.paused ? "▶️ Aktifkan" : "⏸ Jeda",
          callback_data: row.paused ? `mon_resume:${row.id}` : `mon_pause:${row.id}`,
        },
        { text: "🗑 Hapus", callback_data: `mon_del:${row.id}` },
      ],
      [{ text: "⬅️ Daftar Monitor", callback_data: "menu:uptime" }],
    ],
  };
}

async function probeAndStore(env: Env, row: MonitorRow): Promise<ProbeResult> {
  const result = await probe(row.url);
  const now = Date.now();
  await qRun(env, "UPDATE monitors SET status = ?, last_checked = ? WHERE id = ?", result.status, now, row.id);
  row.status = result.status;
  row.last_checked = now;
  return result;
}

export async function addMonitor(
  env: Env,
  userId: number,
  chatId: number,
  url: string,
  intervalArg?: string,
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    await sendMessage(env, chatId, "❌ Kirim URL yang valid. Contoh:\n<code>/monitor add https://example.com</code>");
    return;
  }

  let interval = await getIntervalDefault(env, "monitor");
  if (intervalArg) {
    const parsed = validateInterval("monitor", Number(intervalArg));
    if (parsed === null) {
      await sendMessage(env, chatId, `❌ Interval monitor harus ${intervalRange("monitor")}.`);
      return;
    }
    interval = parsed;
  }

  const count = await qFirst<{ n: number }>(env, "SELECT COUNT(*) AS n FROM monitors WHERE user_id = ?", userId);
  if ((count?.n ?? 0) >= 5) {
    await sendMessage(env, chatId, "❌ Maksimal 5 monitor per user.");
    return;
  }

  const result = await probe(url);
  await qRun(
    env,
    "INSERT INTO monitors(user_id, chat_id, url, status, last_checked, interval_min, paused, created_at) VALUES(?,?,?,?,?,?,0,?)",
    userId,
    chatId,
    url,
    result.status,
    Date.now(),
    interval,
    Date.now(),
  );

  const lines = [
    `${statusIcon(result.status)} <b>Monitor ditambahkan</b>`,
    "",
    esc(url),
    `Status: <b>${statusLabel(result.status)}</b>${result.code ? ` (${result.code})` : ""}${result.ms ? ` · ${result.ms} ms` : ""}`,
    `⏱ Cek tiap <b>${interval} menit</b>.`,
  ];
  if (result.via) lines.push(`Via: ${esc(result.via)}`);
  if (result.note) lines.push(`\n⚠️ ${esc(result.note)}`);
  if (result.status === "protected") {
    lines.push("\n<i>Server merespons, tapi akses dibatasi (login/Cloudflare).</i>");
  }
  await sendMessage(env, chatId, lines.join("\n"));
}

export async function cmdMonitor(ctx: Ctx): Promise<void> {
  const sub = (ctx.args[0] ?? "").toLowerCase();

  if (sub === "add") {
    const { url, intervalRaw } = splitUrlInterval(ctx.args.slice(1));
    return addMonitor(ctx.env, ctx.userId, ctx.chatId, url, intervalRaw ?? undefined);
  }

  if (sub === "del" || sub === "delete") {
    const id = Number(ctx.args[1]);
    await qRun(ctx.env, "DELETE FROM monitors WHERE id = ? AND user_id = ?", id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `🗑 Monitor #${id} dihapus.`);
  }

  if (sub === "test" || sub === "check") {
    const id = Number(ctx.args[1]);
    const row = await qFirst<MonitorRow>(
      ctx.env,
      "SELECT * FROM monitors WHERE id = ? AND user_id = ?",
      id,
      ctx.userId,
    );
    if (!row) return sendMessage(ctx.env, ctx.chatId, "❌ Monitor tidak ditemukan.");
    const result = await probeAndStore(ctx.env, row);
    await sendMessage(ctx.env, ctx.chatId, monitorDetailText(row, result), {
      keyboard: monitorDetailKeyboard(row),
    });
    return;
  }

  if (sub === "every" || sub === "interval") {
    const id = Number(ctx.args[1]);
    const interval = validateInterval("monitor", Number(ctx.args[2]));
    if (!Number.isFinite(id) || interval === null) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        `Contoh: <code>/monitor every 2 10</code>\nInterval: ${intervalRange("monitor")}.`,
      );
    }
    await qRun(
      ctx.env,
      "UPDATE monitors SET interval_min = ? WHERE id = ? AND user_id = ?",
      interval,
      id,
      ctx.userId,
    );
    return sendMessage(ctx.env, ctx.chatId, `⏱ Monitor #${id} sekarang dicek tiap <b>${interval} menit</b>.`);
  }

  if (sub === "pause" || sub === "resume") {
    const id = Number(ctx.args[1]);
    if (!Number.isFinite(id)) return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/monitor pause 2</code>");
    await qRun(
      ctx.env,
      "UPDATE monitors SET paused = ? WHERE id = ? AND user_id = ?",
      sub === "pause" ? 1 : 0,
      id,
      ctx.userId,
    );
    return sendMessage(ctx.env, ctx.chatId, sub === "pause" ? `⏸ Monitor #${id} dijeda.` : `▶️ Monitor #${id} aktif.`);
  }

  if (ctx.args.length && sub !== "list") {
    return sendMessage(
      ctx.env,
      ctx.chatId,
      "📈 <b>Monitor</b>\n\n" +
        "<code>/monitor add &lt;url&gt; [menit]</code>\n" +
        "<code>/monitor test &lt;id&gt;</code>\n" +
        "<code>/monitor every &lt;id&gt; &lt;menit&gt;</code>\n" +
        "<code>/monitor pause|resume &lt;id&gt;</code>\n" +
        "<code>/monitor del &lt;id&gt;</code>",
    );
  }

  const rows = await qAll<MonitorRow>(ctx.env, "SELECT * FROM monitors WHERE user_id = ? ORDER BY id", ctx.userId);
  if (!rows.length) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "📈 <b>Uptime Monitor</b>\n\n" +
        "Tambah: <code>/monitor add https://example.com</code>\n" +
        "Dengan interval: <code>/monitor add &lt;url&gt; 10</code>\n\n" +
        `<i>Default ${await getIntervalDefault(ctx.env, "monitor")} menit.</i>`,
    );
    return;
  }

  const lines = ["📈 <b>Monitor kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(
      `${statusIcon(row.status)} <b>#${row.id}</b> ${esc(shortUrl(row.url))} · ${row.interval_min ?? 5}m${
        row.paused ? " · ⏸" : ""
      }`,
    );
    keyboard.push([
      { text: `${statusIcon(row.status)} #${row.id} ${shortUrl(row.url)}`.slice(0, 60), callback_data: `mon_view:${row.id}` },
    ]);
  }
  lines.push("", "<i>Klik monitor untuk detail, cek sekarang, atau ubah interval.</i>");
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function handleMonitorCallback(
  env: Env,
  chatId: number,
  messageId: number,
  userId: number,
  data: string,
): Promise<boolean> {
  const [action, rawId, rawValue] = data.split(":");
  const id = Number(rawId);
  if (!["mon_view", "mon_check", "mon_every", "mon_pause", "mon_resume"].includes(action)) return false;
  if (!Number.isFinite(id)) return false;

  const row = await qFirst<MonitorRow>(env, "SELECT * FROM monitors WHERE id = ? AND user_id = ?", id, userId);
  if (!row) {
    await editMessage(env, chatId, messageId, "❌ Monitor tidak ditemukan.", { keyboard: backMenu() });
    return true;
  }

  if (action === "mon_view") {
    await editMessage(env, chatId, messageId, monitorDetailText(row), { keyboard: monitorDetailKeyboard(row) });
    return true;
  }

  if (action === "mon_check") {
    await editMessage(env, chatId, messageId, `⏳ Mengecek <code>${esc(shortUrl(row.url))}</code>…`).catch(() => undefined);
    const result = await probeAndStore(env, row);
    await editMessage(env, chatId, messageId, monitorDetailText(row, result), {
      keyboard: monitorDetailKeyboard(row),
    });
    return true;
  }

  if (action === "mon_every") {
    const interval = validateInterval("monitor", Number(rawValue));
    if (interval === null) return true;
    await qRun(env, "UPDATE monitors SET interval_min = ? WHERE id = ?", interval, id);
    row.interval_min = interval;
    await editMessage(env, chatId, messageId, monitorDetailText(row), { keyboard: monitorDetailKeyboard(row) });
    return true;
  }

  const paused = action === "mon_pause" ? 1 : 0;
  await qRun(env, "UPDATE monitors SET paused = ? WHERE id = ?", paused, id);
  row.paused = paused;
  await editMessage(env, chatId, messageId, monitorDetailText(row), { keyboard: monitorDetailKeyboard(row) });
  return true;
}

/* ------------------------------- alert ------------------------------- */

const COINS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  TON: "the-open-network",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  TRX: "tron",
  LTC: "litecoin",
  SHIB: "shiba-inu",
};

export async function cmdAlert(ctx: Ctx): Promise<void> {
  const sub = (ctx.args[0] ?? "").toLowerCase();

  if (sub === "del" || sub === "delete") {
    const id = Number(ctx.args[1]);
    await qRun(ctx.env, "DELETE FROM alerts WHERE id = ? AND user_id = ?", id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `🗑 Alert #${id} dihapus.`);
  }

  if (sub === "every" || sub === "interval") {
    const id = Number(ctx.args[1]);
    const interval = validateInterval("alert", Number(ctx.args[2]));
    if (!Number.isFinite(id) || interval === null) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        `Contoh: <code>/alert every 1 30</code>\nInterval: ${intervalRange("alert")}.`,
      );
    }
    await qRun(ctx.env, "UPDATE alerts SET interval_min = ? WHERE id = ? AND user_id = ?", interval, id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `⏱ Alert #${id} sekarang dicek tiap <b>${interval} menit</b>.`);
  }

  const creating = ["<", ">"].includes(ctx.args[1] ?? "") || ctx.args.length >= 3;
  if (creating) {
    const symbol = (ctx.args[0] ?? "").toUpperCase();
    const op = ctx.args[1];
    const target = Number(ctx.args[2]);
    const explicitInterval = ctx.args[3];

    if (!COINS[symbol] || !["<", ">"].includes(op) || !Number.isFinite(target)) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        "❌ Format: <code>/alert BTC &gt; 100000</code>\nKoin: " + Object.keys(COINS).join(", "),
      );
    }

    let interval = await getIntervalDefault(ctx.env, "alert");
    if (explicitInterval) {
      const parsed = validateInterval("alert", Number(explicitInterval));
      if (parsed === null) {
        return sendMessage(ctx.env, ctx.chatId, `❌ Interval alert harus ${intervalRange("alert")}.`);
      }
      interval = parsed;
    }

    const count = await qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?",
      ctx.userId,
    );
    if ((count?.n ?? 0) >= 10) {
      return sendMessage(ctx.env, ctx.chatId, "❌ Maksimal 10 alert per user.");
    }

    await qRun(
      ctx.env,
      "INSERT INTO alerts(user_id, chat_id, symbol, op, target, triggered, interval_min, last_checked, created_at) VALUES(?,?,?,?,?,0,?,NULL,?)",
      ctx.userId,
      ctx.chatId,
      symbol,
      op,
      target,
      interval,
      Date.now(),
    );
    return sendMessage(
      ctx.env,
      ctx.chatId,
      `🔔 Alert diset: <b>${symbol} ${op} ${target.toLocaleString("en-US")}</b> (USD)\n` +
        `⏱ Cek tiap <b>${interval} menit</b>.`,
    );
  }

  const rows = await qAll<AlertRow>(ctx.env, "SELECT * FROM alerts WHERE user_id = ? ORDER BY id", ctx.userId);
  if (!rows.length) {
    return sendMessage(
      ctx.env,
      ctx.chatId,
      "🔔 <b>Alert Harga</b>\n\n<code>/alert BTC &gt; 100000</code>\n<code>/alert ETH &lt; 2000</code>\n\n" +
        "Koin: " +
        Object.keys(COINS).join(", "),
    );
  }

  const lines = ["🔔 <b>Alert kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(
      `<b>#${row.id}</b> ${row.symbol} ${row.op} ${row.target.toLocaleString("en-US")} USD · tiap ${
        row.interval_min ?? 15
      }m`,
    );
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `alert_del:${row.id}` }]);
  }
  lines.push("", "<i>Ubah interval: /alert every &lt;id&gt; &lt;menit&gt;</i>");
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

/* -------------------------------- cron ------------------------------- */

async function safeSend(env: Env, chatId: number | string, text: string, keyboard?: any): Promise<void> {
  try {
    await sendMessage(env, chatId, text, keyboard ? { keyboard } : {});
  } catch (err) {
    console.warn("notify failed", (err as Error).message);
  }
}

export async function checkFeeds(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await qAll<FeedRow>(
    env,
    "SELECT * FROM feeds WHERE last_checked IS NULL OR last_checked + COALESCE(interval_min, 10) * 60000 <= ? ORDER BY COALESCE(last_checked, 0) ASC LIMIT 5",
    now,
  );

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        const feed = await fetchFeed(row.url);
        const seenIndex = row.last_seen ? feed.items.findIndex((it) => it.id === row.last_seen) : -1;
        const fresh = seenIndex >= 0 ? feed.items.slice(0, seenIndex) : feed.items.slice(0, 1);

        for (const item of fresh.reverse().slice(-3)) {
          const link = item.link ? `\n<a href="${esc(item.link)}">Buka</a>` : "";
          await safeSend(
            env,
            row.chat_id,
            `📰 <b>${esc(feed.title || row.title || "Feed")}</b>\n\n${esc(item.title)}${link}`,
          );
        }

        await qRun(
          env,
          "UPDATE feeds SET last_seen = ?, last_checked = ?, title = ? WHERE id = ?",
          feed.items[0].id,
          Date.now(),
          feed.title || row.title,
          row.id,
        );
      } catch (err) {
        console.warn("feed check failed", row.id, (err as Error).message);
        await qRun(env, "UPDATE feeds SET last_checked = ? WHERE id = ?", Date.now(), row.id);
      }
    }),
  );
}

export async function checkMonitors(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await qAll<MonitorRow>(
    env,
    "SELECT * FROM monitors WHERE paused = 0 AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 5) * 60000 <= ?) ORDER BY COALESCE(last_checked, 0) ASC LIMIT 10",
    now,
  );

  await Promise.allSettled(
    rows.map(async (row) => {
      const previous = row.status;
      const result = await probe(row.url);

      if (previous && previous !== result.status) {
        const lines: string[] = [];
        if (result.status === "down") {
          lines.push("🔴 <b>Website down</b>");
        } else if (previous === "down") {
          lines.push(result.status === "up" ? "🟢 <b>Website kembali online</b>" : "🟡 <b>Website kembali merespons</b>");
        } else {
          lines.push(result.status === "protected" ? "🟡 <b>Website terproteksi</b>" : "🟢 <b>Website normal kembali</b>");
        }
        lines.push("", esc(row.url), `Status: ${statusIcon(result.status)} ${statusLabel(result.status)}${result.code ? ` (${result.code})` : ""}`);
        if (result.note) lines.push(`⚠️ ${esc(result.note)}`);
        await safeSend(env, row.chat_id, lines.join("\n"));
      }

      await qRun(
        env,
        "UPDATE monitors SET status = ?, last_checked = ? WHERE id = ?",
        result.status,
        Date.now(),
        row.id,
      );
    }),
  );
}

export async function checkAlerts(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await qAll<AlertRow>(
    env,
    "SELECT * FROM alerts WHERE triggered = 0 AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 15) * 60000 <= ?) ORDER BY COALESCE(last_checked, 0) ASC LIMIT 50",
    now,
  );
  if (!rows.length) return;

  const ids = [...new Set(rows.map((r) => COINS[r.symbol]).filter(Boolean))];
  if (!ids.length) return;

  let prices: Record<string, { usd: number }> = {};
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
      {
        headers: { accept: "application/json", "user-agent": API_UA },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (res.ok) prices = (await res.json()) as Record<string, { usd: number }>;
    else console.warn("coingecko failed", res.status);
  } catch (err) {
    console.warn("coingecko error", (err as Error).message);
  }

  if (!Object.keys(prices).length) {
    const symbols = [...new Set(rows.map((r) => r.symbol))];
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`, {
            headers: { accept: "application/json", "user-agent": API_UA },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const json: any = await res.json();
          if (json?.price && COINS[symbol]) prices[COINS[symbol]] = { usd: Number(json.price) };
        } catch {
          /* skip symbol */
        }
      }),
    );
  }

  const checkedAt = Date.now();
  for (const row of rows) {
    const price = prices[COINS[row.symbol]]?.usd;
    if (Number.isFinite(price)) {
      const hit = row.op === ">" ? price >= row.target : price <= row.target;
      if (hit) {
        await safeSend(
          env,
          row.chat_id,
          `🔔 <b>Alert tercapai</b>\n\n${row.symbol} sekarang <b>$${price.toLocaleString("en-US")}</b>\n` +
            `Target: ${row.op} ${row.target.toLocaleString("en-US")}`,
        );
        await qRun(env, "UPDATE alerts SET triggered = 1, last_checked = ? WHERE id = ?", checkedAt, row.id);
        continue;
      }
    }
    await qRun(env, "UPDATE alerts SET last_checked = ? WHERE id = ?", checkedAt, row.id);
  }
}

/* ------------------------------- github ------------------------------ */

async function validSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = header.slice("sha256=".length);
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function handleGithubWebhook(env: Env, request: Request): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (signature && !(await validSignature(env.WEBHOOK_SECRET, body, signature))) {
    return new Response("Bad signature", { status: 401 });
  }

  const chat = await getSetting(env, "gh_chat");
  const repo = await getSetting(env, "gh_repo");
  if (!chat) return new Response("gh_chat belum diset", { status: 409 });

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad json", { status: 400 });
  }

  const event = request.headers.get("x-github-event") ?? "unknown";
  const lines: string[] = [];

  if (event === "push") {
    const commits = payload.commits ?? [];
    lines.push(`📦 <b>Push ke ${esc(payload.repository?.full_name ?? repo)}</b>`);
    lines.push(`👤 ${esc(payload.pusher?.name ?? "")} · ${commits.length} commit`);
    lines.push(`🌿 ${esc(String(payload.ref ?? "").replace("refs/heads/", ""))}`);
    for (const commit of commits.slice(0, 4)) {
      lines.push(
        `• <code>${esc(String(commit.id ?? "").slice(0, 7))}</code> ${esc(commit.message ?? "").split("\n")[0].slice(0, 90)}`,
      );
    }
    if (payload.compare) lines.push(`\n<a href="${esc(payload.compare)}">Lihat diff</a>`);
  } else if (event === "issues") {
    lines.push(`🐛 <b>Issue ${esc(payload.action ?? "")}</b>`);
    lines.push(`#${payload.issue?.number} ${esc(payload.issue?.title ?? "")}`);
    lines.push(`oleh ${esc(payload.sender?.login ?? "")}`);
    if (payload.issue?.html_url) lines.push(`\n<a href="${esc(payload.issue.html_url)}">Buka issue</a>`);
  } else if (event === "pull_request") {
    lines.push(`🔀 <b>Pull request ${esc(payload.action ?? "")}</b>`);
    lines.push(`#${payload.pull_request?.number} ${esc(payload.pull_request?.title ?? "")}`);
    lines.push(`oleh ${esc(payload.sender?.login ?? "")}`);
    if (payload.pull_request?.html_url) lines.push(`\n<a href="${esc(payload.pull_request.html_url)}">Buka PR</a>`);
  } else if (event === "release") {
    lines.push(`🚀 <b>Release ${esc(payload.action ?? "")}</b>`);
    lines.push(`${esc(payload.release?.name ?? payload.release?.tag_name ?? "")}`);
    if (payload.release?.html_url) lines.push(`\n<a href="${esc(payload.release.html_url)}">Lihat release</a>`);
  } else if (event === "workflow_run") {
    lines.push(
      `⚙️ <b>Workflow ${esc(payload.workflow_run?.name ?? "")}: ${esc(
        payload.workflow_run?.conclusion ?? payload.action ?? "",
      )}</b>`,
    );
    if (payload.workflow_run?.html_url) lines.push(`\n<a href="${esc(payload.workflow_run.html_url)}">Lihat run</a>`);
  } else {
    lines.push(`🔔 <b>GitHub event: ${esc(event)}</b>`);
    if (payload.repository?.full_name) lines.push(esc(payload.repository.full_name));
  }

  await safeSend(env, chat, lines.join("\n"));
  return new Response("ok");
}

/* ------------------------------ helpers ------------------------------ */

function backMenu(): any {
  return { inline_keyboard: [[{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]] };
}
