import type { Ctx } from "./context";
import { qAll, qFirst } from "../db";
import { esc, sendDocumentBytes, sendMessage, tg } from "../telegram";
import { getOwner, getSetting, listUsers, setRole, setSetting } from "../users";
import { formatWib, wibDay } from "../time";
import { logAudit } from "../stats";
import type { Env } from "../env";
import {
  getIntervalDefault,
  intervalRange,
  validateInterval,
  type IntervalKind,
} from "./monitor";

export async function isOwner(env: Env, userId: number): Promise<boolean> {
  const owner = await getOwner(env);
  return owner?.id === userId;
}

async function ownerOnly(ctx: Ctx): Promise<boolean> {
  if (await isOwner(ctx.env, ctx.userId)) return true;
  await sendMessage(ctx.env, ctx.chatId, "⛔ Perintah ini hanya untuk owner.");
  return false;
}

export async function cmdAllow(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const id = Number(ctx.args[0]);
  if (!Number.isFinite(id)) {
    return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/allow 123456789</code>");
  }
  const ok = await setRole(ctx.env, id, "member");
  await logAudit(ctx.env, ctx.userId, "allow", String(id));
  await sendMessage(ctx.env, ctx.chatId, ok ? `✅ User <code>${id}</code> diizinkan.` : "❌ User tidak ditemukan.");
  if (ok) {
    await sendMessage(ctx.env, id, "✅ Kamu sekarang punya akses ke bot ini. Kirim /start.").catch(() => undefined);
  }
}

export async function cmdDeny(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const id = Number(ctx.args[0]);
  if (!Number.isFinite(id)) {
    return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/deny 123456789</code>");
  }
  const owner = await getOwner(ctx.env);
  if (owner?.id === id) return sendMessage(ctx.env, ctx.chatId, "❌ Tidak bisa menolak owner.");
  const ok = await setRole(ctx.env, id, "blocked");
  await logAudit(ctx.env, ctx.userId, "deny", String(id));
  await sendMessage(ctx.env, ctx.chatId, ok ? `🚫 User <code>${id}</code> diblokir.` : "❌ User tidak ditemukan.");
}

export async function cmdUsers(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const rows = await listUsers(ctx.env, 40);
  const lines = ["👥 <b>Pengguna bot</b>", ""];
  for (const row of rows) {
    const name = row.username ? `@${row.username}` : row.first_name ?? "-";
    lines.push(`${row.role === "owner" ? "👑" : row.role === "member" ? "✅" : row.role === "blocked" ? "🚫" : "⏳"} <code>${row.id}</code> ${esc(name)}`);
  }
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"));
}

export async function cmdStats(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const day = wibDay();
  const stats = await qAll<{ feature: string; count: number }>(
    ctx.env,
    "SELECT feature, count FROM stats WHERE day = ? ORDER BY count DESC",
    day,
  );
  const users = await qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM users");
  const vault = await qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM vault");
  const downloads = stats.reduce((sum, s) => sum + (s.feature.startsWith("dl:") ? s.count : 0), 0);

  const lines = [
    "📊 <b>Statistik hari ini</b>",
    `📅 ${day}`,
    "",
    `👥 User: ${users?.n ?? 0}`,
    `🗂 Vault item: ${vault?.n ?? 0}`,
    `⬇️ Download: ${downloads}`,
    "",
  ];
  if (!stats.length) lines.push("<i>Belum ada aktivitas.</i>");
  for (const row of stats) lines.push(`• ${esc(row.feature)}: <b>${row.count}</b>`);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"));
}

export async function cmdAudit(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const rows = await qAll<{ id: number; user_id: number; action: string; meta: string | null; created_at: number }>(
    ctx.env,
    "SELECT * FROM audit ORDER BY id DESC LIMIT 20",
  );
  if (!rows.length) return sendMessage(ctx.env, ctx.chatId, "🧾 Belum ada audit.");
  const lines = ["🧾 <b>Audit terakhir</b>", ""];
  for (const row of rows) {
    lines.push(`${formatWib(row.created_at)} · <code>${row.user_id}</code> · ${esc(row.action)}${row.meta ? ` · ${esc(row.meta)}` : ""}`);
  }
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"));
}

export async function cmdStatus(ctx: Ctx): Promise<void> {
  const lines = ["⚙️ <b>Status bot</b>", ""];

  try {
    await qFirst(ctx.env, "SELECT 1 AS ok");
    lines.push("🟢 D1 database: OK");
  } catch (err) {
    lines.push(`🔴 D1 database: ${esc((err as Error).message)}`);
  }

  try {
    const probe = await ctx.env.BOT_KV.get("health:probe");
    lines.push(`🟢 KV: OK${probe ? "" : " (kosong)"}`);
  } catch (err) {
    lines.push(`🔴 KV: ${esc((err as Error).message)}`);
  }

  lines.push(ctx.env.AI ? "🟢 AI: aktif" : "🔴 AI: tidak aktif");

  try {
    const info: any = await tg(ctx.env, "getWebhookInfo");
    lines.push(`🔗 Webhook: ${info?.url ? "terpasang" : "belum"} · pending ${info?.pending_update_count ?? 0}`);
    if (info?.last_error_message) lines.push(`⚠️ ${esc(String(info.last_error_message).slice(0, 120))}`);
  } catch {
    lines.push("⚪ Webhook: tidak bisa dicek");
  }

  const ghRepo = await getSetting(ctx.env, "gh_repo");
  lines.push(`🐙 GitHub: ${ghRepo ? esc(ghRepo) : "belum diset"}`);
  lines.push(`🕒 ${formatWib(Date.now())}`);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"));
}

export async function cmdBackup(ctx: Ctx): Promise<void> {
  const env = ctx.env;
  const userId = ctx.userId;
  const data = {
    exported_at: new Date().toISOString(),
    user: userId,
    notes: await qAll(env, "SELECT id, text, created_at FROM notes WHERE user_id = ?", userId),
    todos: await qAll(env, "SELECT id, text, done, created_at FROM todos WHERE user_id = ?", userId),
    reminders: await qAll(env, "SELECT id, text, due_at, sent FROM reminders WHERE user_id = ?", userId),
    vault: await qAll(env, "SELECT id, kind, name, size, mime, caption, file_id, created_at FROM vault WHERE user_id = ?", userId),
    feeds: await qAll(env, "SELECT id, url, title FROM feeds WHERE user_id = ?", userId),
    monitors: await qAll(env, "SELECT id, url, status FROM monitors WHERE user_id = ?", userId),
    alerts: await qAll(env, "SELECT id, symbol, op, target, triggered FROM alerts WHERE user_id = ?", userId),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await sendDocumentBytes(
    env,
    ctx.chatId,
    bytes,
    `backup-${wibDay()}.json`,
    "application/json",
    { caption: "💾 <b>Backup data kamu</b>\n<i>File vault tetap di server Telegram; backup hanya berisi index.</i>", parse_mode: "HTML" },
  );
}

export async function cmdGh(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;
  const input = ctx.args.join(" ").trim();

  if (!input || input === "off") {
    await setSetting(ctx.env, "gh_repo", "");
    await setSetting(ctx.env, "gh_chat", "");
    return sendMessage(ctx.env, ctx.chatId, "🐙 Notifikasi GitHub dimatikan.");
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(input)) {
    return sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/gh awand795/bot-tele</code>");
  }

  await setSetting(ctx.env, "gh_repo", input);
  await setSetting(ctx.env, "gh_chat", String(ctx.chatId));
  await sendMessage(
    ctx.env,
    ctx.chatId,
    `🐙 Notifikasi GitHub untuk <b>${esc(input)}</b> aktif di chat ini.\n\n` +
      `Webhook URL:\n<code>${esc(ctx.origin)}/gh/${ctx.env.WEBHOOK_SECRET}</code>\n` +
      `Content type: <code>application/json</code>\nSecret: <code>${esc(ctx.env.WEBHOOK_SECRET)}</code>\n` +
      `Event: push, issues, pull_request, release, workflow_run`,
  );
}

export async function cmdCron(ctx: Ctx): Promise<void> {
  if (!(await ownerOnly(ctx))) return;

  const sub = (ctx.args[0] ?? "").toLowerCase();
  if (sub === "set") {
    const aliases: Record<string, IntervalKind> = {
      monitor: "monitor",
      uptime: "monitor",
      rss: "rss",
      feed: "rss",
      alert: "alert",
      harga: "alert",
    };
    const kind = aliases[(ctx.args[1] ?? "").toLowerCase()];
    const value = validateInterval(kind ?? "monitor", Number(ctx.args[2]));
    if (!kind || value === null) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        "Contoh: <code>/cron set monitor 10</code>\n" +
          "Jenis: <code>monitor</code>, <code>rss</code>, <code>alert</code>\n" +
          `Rentang: monitor ${intervalRange("monitor")}, RSS ${intervalRange("rss")}, alert ${intervalRange("alert")}.`,
      );
    }
    await setSetting(ctx.env, `interval_${kind}`, String(value));
    await logAudit(ctx.env, ctx.userId, "cron_set", `${kind}=${value}`);
    return sendMessage(
      ctx.env,
      ctx.chatId,
      `⏱ Default interval <b>${kind}</b> sekarang <b>${value} menit</b>.\n<i>Item lama tidak berubah; atur per item lewat /${kind === "monitor" ? "monitor every" : kind === "rss" ? "rss every" : "alert every"}.</i>`,
    );
  }

  const defaults = {
    monitor: await getIntervalDefault(ctx.env, "monitor"),
    rss: await getIntervalDefault(ctx.env, "rss"),
    alert: await getIntervalDefault(ctx.env, "alert"),
  };
  const now = Date.now();

  const [monitorDue, feedDue, alertDue, monitorAll, feedAll, alertAll] = await Promise.all([
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM monitors WHERE paused = 0 AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 5) * 60000 <= ?)",
      now,
    ),
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM feeds WHERE last_checked IS NULL OR last_checked + COALESCE(interval_min, 10) * 60000 <= ?",
      now,
    ),
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM alerts WHERE triggered = 0 AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 15) * 60000 <= ?)",
      now,
    ),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM monitors"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM feeds"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM alerts WHERE triggered = 0"),
  ]);

  await sendMessage(
    ctx.env,
    ctx.chatId,
    [
      "⏱ <b>Cron & interval</b>",
      "",
      "Reminder: tiap <b>1 menit</b> (tetap)",
      `Monitor: default <b>${defaults.monitor} menit</b>`,
      `RSS: default <b>${defaults.rss} menit</b>`,
      `Alert: default <b>${defaults.alert} menit</b>`,
      "",
      `<b>Antrean sekarang</b>`,
      `📈 monitor due: ${monitorDue?.n ?? 0}/${monitorAll?.n ?? 0}`,
      `📡 feed due: ${feedDue?.n ?? 0}/${feedAll?.n ?? 0}`,
      `🔔 alert due: ${alertDue?.n ?? 0}/${alertAll?.n ?? 0}`,
      "",
      "<b>Ubah default</b>",
      "<code>/cron set monitor 10</code>",
      "<code>/cron set rss 30</code>",
      "<code>/cron set alert 15</code>",
      "",
      "<i>Interval per item: /monitor every, /rss every, /alert every.</i>",
    ].join("\n"),
  );
}

export async function notifyOwnerNewUser(env: Env, userId: number, name: string): Promise<void> {
  const owner = await getOwner(env);
  if (!owner) return;
  try {
    await sendMessage(
      env,
      owner.id,
      `👤 <b>User baru minta akses</b>\n\n<code>${userId}</code> ${esc(name)}\n\n` +
        `Izinkan: <code>/allow ${userId}</code>\nBlokir: <code>/deny ${userId}</code>`,
    );
  } catch {
    /* owner may never have started the bot */
  }
}
