import type { Ctx } from "./context";
import { qAll, qFirst, qRun } from "../db";
import type { Env } from "../env";
import { esc, sendMessage } from "../telegram";
import { getSetting } from "../users";

interface FeedRow {
  id: number;
  user_id: number;
  chat_id: number;
  url: string;
  title: string | null;
  last_seen: string | null;
  last_checked: number | null;
}
interface MonitorRow {
  id: number;
  user_id: number;
  chat_id: number;
  url: string;
  status: string | null;
  last_checked: number | null;
}
interface AlertRow {
  id: number;
  user_id: number;
  chat_id: number;
  symbol: string;
  op: string;
  target: number;
}

/* -------------------------------- RSS -------------------------------- */

const FEED_UA = "Mozilla/5.0 (compatible; AdnawaaBot/1.0; +https://github.com/awand795/bot-tele)";
const API_UA = "AdnawaaBot/1.0 (+https://github.com/awand795/bot-tele)";

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

export async function addRss(env: Env, userId: number, chatId: number, url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    await sendMessage(env, chatId, "❌ Kirim URL feed yang valid. Contoh:\n<code>/rss add https://hnrss.org/frontpage</code>");
    return;
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
    "INSERT INTO feeds(user_id, chat_id, url, title, last_seen, last_checked, created_at) VALUES(?,?,?,?,?,?,?)",
    userId,
    chatId,
    url,
    feed.title,
    feed.items[0].id,
    Date.now(),
    Date.now(),
  );
  await sendMessage(
    env,
    chatId,
    `📡 <b>Feed ditambahkan</b>\n\n${esc(feed.title || url)}\n${esc(feed.items[0].title)}\n\n` +
      `<i>Cek otomatis tiap ±10 menit.</i>`,
  );
}

export async function cmdRss(ctx: Ctx): Promise<void> {
  const sub = (ctx.args[0] ?? "").toLowerCase();
  if (sub === "add") {
    return addRss(ctx.env, ctx.userId, ctx.chatId, ctx.args.slice(1).join(" ").trim());
  }
  if (sub === "del" || sub === "delete") {
    const id = Number(ctx.args[1]);
    if (!Number.isFinite(id)) return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/rss del 3</code>");
    await qRun(ctx.env, "DELETE FROM feeds WHERE id = ? AND user_id = ?", id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `🗑 Feed #${id} dihapus.`);
  }
  if (ctx.args.length) {
    return addRss(ctx.env, ctx.userId, ctx.chatId, ctx.args.join(" ").trim());
  }

  const rows = await qAll<FeedRow>(ctx.env, "SELECT * FROM feeds WHERE user_id = ? ORDER BY id", ctx.userId);
  if (!rows.length) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "📡 <b>RSS Monitor</b>\n\nTambah: <code>/rss add https://hnrss.org/frontpage</code>\nDaftar: /rss",
    );
    return;
  }
  const lines = ["📡 <b>Feed kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`<b>#${row.id}</b> ${esc(row.title || row.url)}`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `rss_del:${row.id}` }]);
  }
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

/* ------------------------------ uptime ------------------------------- */

async function probe(url: string): Promise<{ status: string; code?: number }> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": FEED_UA },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    return { status: res.ok ? "up" : "down", code: res.status };
  } catch (err) {
    return { status: "down", code: 0 };
  }
}

export async function addMonitor(env: Env, userId: number, chatId: number, url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    await sendMessage(env, chatId, "❌ Kirim URL yang valid. Contoh:\n<code>/monitor add https://example.com</code>");
    return;
  }
  const count = await qFirst<{ n: number }>(env, "SELECT COUNT(*) AS n FROM monitors WHERE user_id = ?", userId);
  if ((count?.n ?? 0) >= 5) {
    await sendMessage(env, chatId, "❌ Maksimal 5 monitor per user.");
    return;
  }
  const now = await probe(url);
  await qRun(
    env,
    "INSERT INTO monitors(user_id, chat_id, url, status, last_checked, created_at) VALUES(?,?,?,?,?,?)",
    userId,
    chatId,
    url,
    now.status,
    Date.now(),
    Date.now(),
  );
  await sendMessage(
    env,
    chatId,
    `${now.status === "up" ? "🟢" : "🔴"} <b>Monitor ditambahkan</b>\n\n${esc(url)}\nStatus: ${now.status}${
      now.code ? ` (${now.code})` : ""
    }\n\n<i>Cek tiap ±5 menit.</i>`,
  );
}

export async function cmdMonitor(ctx: Ctx): Promise<void> {
  const sub = (ctx.args[0] ?? "").toLowerCase();
  if (sub === "add") return addMonitor(ctx.env, ctx.userId, ctx.chatId, ctx.args.slice(1).join(" ").trim());
  if (sub === "del" || sub === "delete") {
    const id = Number(ctx.args[1]);
    await qRun(ctx.env, "DELETE FROM monitors WHERE id = ? AND user_id = ?", id, ctx.userId);
    return sendMessage(ctx.env, ctx.chatId, `🗑 Monitor #${id} dihapus.`);
  }

  const rows = await qAll<MonitorRow>(ctx.env, "SELECT * FROM monitors WHERE user_id = ? ORDER BY id", ctx.userId);
  if (!rows.length) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "📈 <b>Uptime Monitor</b>\n\nTambah: <code>/monitor add https://example.com</code>",
    );
    return;
  }
  const lines = ["📈 <b>Monitor kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`${row.status === "up" ? "🟢" : "🔴"} <b>#${row.id}</b> ${esc(row.url)}`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `mon_del:${row.id}` }]);
  }
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
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

  if (ctx.args.length >= 3) {
    const symbol = ctx.args[0].toUpperCase();
    const op = ctx.args[1];
    const target = Number(ctx.args[2]);
    if (!COINS[symbol] || !["<", ">"].includes(op) || !Number.isFinite(target)) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        "❌ Format: <code>/alert BTC &gt; 100000</code>\nKoin: " + Object.keys(COINS).join(", "),
      );
    }
    const count = await qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?", ctx.userId);
    if ((count?.n ?? 0) >= 10) {
      return sendMessage(ctx.env, ctx.chatId, "❌ Maksimal 10 alert per user.");
    }
    await qRun(
      ctx.env,
      "INSERT INTO alerts(user_id, chat_id, symbol, op, target, triggered, created_at) VALUES(?,?,?,?,?,0,?)",
      ctx.userId,
      ctx.chatId,
      symbol,
      op,
      target,
      Date.now(),
    );
    return sendMessage(
      ctx.env,
      ctx.chatId,
      `🔔 Alert diset: <b>${symbol} ${op} ${target.toLocaleString("en-US")}</b> (USD)\n<i>Cek tiap ±15 menit.</i>`,
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
    lines.push(`<b>#${row.id}</b> ${row.symbol} ${row.op} ${row.target.toLocaleString("en-US")} USD`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `alert_del:${row.id}` }]);
  }
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
  const rows = await qAll<FeedRow>(env, "SELECT * FROM feeds ORDER BY COALESCE(last_checked, 0) ASC LIMIT 5");

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
  const rows = await qAll<MonitorRow>(env, "SELECT * FROM monitors ORDER BY COALESCE(last_checked, 0) ASC LIMIT 5");

  await Promise.allSettled(
    rows.map(async (row) => {
      const result = await probe(row.url);
      if (row.status && row.status !== result.status) {
        const ok = result.status === "up";
        await safeSend(
          env,
          row.chat_id,
          `${ok ? "🟢" : "🔴"} <b>${ok ? "Website kembali online" : "Website down"}</b>\n\n${esc(row.url)}${
            result.code ? `\nKode: ${result.code}` : ""
          }`,
        );
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
  const rows = await qAll<AlertRow>(env, "SELECT * FROM alerts WHERE triggered = 0");
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

  for (const row of rows) {
    const price = prices[COINS[row.symbol]]?.usd;
    if (!Number.isFinite(price)) continue;
    const hit = row.op === ">" ? price >= row.target : price <= row.target;
    if (!hit) continue;
    await safeSend(
      env,
      row.chat_id,
      `🔔 <b>Alert tercapai</b>\n\n${row.symbol} sekarang <b>$${price.toLocaleString("en-US")}</b>\n` +
        `Target: ${row.op} ${row.target.toLocaleString("en-US")}`,
    );
    await qRun(env, "UPDATE alerts SET triggered = 1 WHERE id = ?", row.id);
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
      lines.push(`• <code>${esc(String(commit.id ?? "").slice(0, 7))}</code> ${esc(commit.message ?? "").split("\n")[0].slice(0, 90)}`);
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
    lines.push(`⚙️ <b>Workflow ${esc(payload.workflow_run?.name ?? "")}: ${esc(payload.workflow_run?.conclusion ?? payload.action ?? "")}</b>`);
    if (payload.workflow_run?.html_url) lines.push(`\n<a href="${esc(payload.workflow_run.html_url)}">Lihat run</a>`);
  } else {
    lines.push(`🔔 <b>GitHub event: ${esc(event)}</b>`);
    if (payload.repository?.full_name) lines.push(esc(payload.repository.full_name));
  }

  await safeSend(env, chat, lines.join("\n"));
  return new Response("ok");
}
