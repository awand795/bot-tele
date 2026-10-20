import type { Ctx } from "./context";
import { qAll, qFirst } from "../db";
import { esc, sendDocumentBytes, sendMessage, tg } from "../telegram";
import { getOwner, getSetting, listUsers, setRole, setSetting } from "../users";
import { formatWib, wibDay } from "../time";
import { logAudit } from "../stats";
import type { Env } from "../env";
import { nextCronRuns, parseCron } from "../cron-expr";
import { getDefaultSchedule, resolveSchedule, type IntervalKind } from "./monitor";

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

  if (sub === "test") {
    const raw = ctx.args.slice(1).join(" ").trim();
    const parsed = parseCron(raw);
    if (!parsed.spec) {
      return sendMessage(ctx.env, ctx.chatId, `❌ ${parsed.error ?? "Ekspresi cron tidak valid."}`);
    }
    const runs = nextCronRuns(parsed.spec, Date.now(), 5);
    if (!runs.length) {
      return sendMessage(ctx.env, ctx.chatId, "❌ Tidak ada jadwal berikutnya dalam 8 tahun.");
    }
    return sendMessage(
      ctx.env,
      ctx.chatId,
      [
        `🕘 <b>Cron test</b>`,
        `<code>${esc(parsed.spec.expr)}</code> (WIB)`,
        "",
        ...runs.map((run, index) => `${index + 1}. ${formatWib(run)}`),
      ].join("\n"),
    );
  }

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
    const raw = ctx.args.slice(2).join(" ").trim();

    if (!kind || !raw) {
      return sendMessage(
        ctx.env,
        ctx.chatId,
        "Contoh:\n" +
          "<code>/cron set monitor 10</code>\n" +
          "<code>/cron set monitor */10 * * * *</code>\n" +
          "<code>/cron set rss */15 * * * *</code>\n" +
          "<code>/cron set alert 0 * * * *</code>\n\n" +
          "Jenis: <code>monitor</code>, <code>rss</code>, <code>alert</code>.",
      );
    }

    const parsed = await resolveSchedule(ctx.env, kind, raw);
    if (!parsed.schedule) {
      return sendMessage(ctx.env, ctx.chatId, `❌ ${parsed.error ?? "Jadwal tidak valid."}`);
    }
    const schedule = parsed.schedule;

    if (schedule.cron) {
      await setSetting(ctx.env, `cron_${kind}`, schedule.cron);
      await logAudit(ctx.env, ctx.userId, "cron_set", `${kind}=${schedule.cron}`);
      return sendMessage(
        ctx.env,
        ctx.chatId,
        `⏱ Default <b>${kind}</b> sekarang cron <code>${esc(schedule.cron)}</code> (WIB).\n` +
          `<i>Item baru otomatis memakai jadwal ini. Item lama tidak berubah.</i>`,
      );
    }

    const minutes = schedule.minutes;
    await setSetting(ctx.env, `interval_${kind}`, String(minutes));
    await setSetting(ctx.env, `cron_${kind}`, "");
    await logAudit(ctx.env, ctx.userId, "cron_set", `${kind}=${minutes}m`);
    return sendMessage(
      ctx.env,
      ctx.chatId,
      `⏱ Default <b>${kind}</b> sekarang <b>${minutes} menit</b>.\n` +
        `<i>Item baru otomatis memakai interval ini. Item lama tidak berubah.</i>`,
    );
  }

  const defaults = {
    monitor: await getDefaultSchedule(ctx.env, "monitor"),
    rss: await getDefaultSchedule(ctx.env, "rss"),
    alert: await getDefaultSchedule(ctx.env, "alert"),
  };
  const now = Date.now();

  const [
    monitorDue,
    feedDue,
    alertDue,
    monitorAll,
    feedAll,
    alertAll,
    monitorCron,
    feedCron,
    alertCron,
  ] = await Promise.all([
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM monitors WHERE paused = 0 AND ((cron_expr IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?) OR (cron_expr IS NULL AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 5) * 60000 <= ?)))",
      now,
      now,
    ),
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM feeds WHERE (cron_expr IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?) OR (cron_expr IS NULL AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 10) * 60000 <= ?))",
      now,
      now,
    ),
    qFirst<{ n: number }>(
      ctx.env,
      "SELECT COUNT(*) AS n FROM alerts WHERE triggered = 0 AND ((cron_expr IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?) OR (cron_expr IS NULL AND (last_checked IS NULL OR last_checked + COALESCE(interval_min, 15) * 60000 <= ?)))",
      now,
      now,
    ),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM monitors"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM feeds"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM alerts WHERE triggered = 0"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM monitors WHERE cron_expr IS NOT NULL"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM feeds WHERE cron_expr IS NOT NULL"),
    qFirst<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM alerts WHERE cron_expr IS NOT NULL"),
  ]);

  const defaultLine = (schedule: Awaited<ReturnType<typeof getDefaultSchedule>>): string => {
    if (schedule.cron) return `cron <code>${esc(schedule.cron)}</code> (fallback ${schedule.minutes}m)`;
    return `${schedule.minutes} menit`;
  };

  await sendMessage(
    ctx.env,
    ctx.chatId,
    [
      "⏱ <b>Cron & jadwal</b>",
      "",
      "Trigger Worker: <code>* * * * *</code> (tiap menit, WIB)",
      "Reminder: tiap <b>1 menit</b> (tetap)",
      "",
      "<b>Default item baru</b>",
      `📈 Monitor: ${defaultLine(defaults.monitor)}`,
      `📡 RSS: ${defaultLine(defaults.rss)}`,
      `🔔 Alert: ${defaultLine(defaults.alert)}`,
      "",
      "<b>Antrean sekarang</b>",
      `📈 monitor due: ${monitorDue?.n ?? 0}/${monitorAll?.n ?? 0} · cron ${monitorCron?.n ?? 0}`,
      `📡 feed due: ${feedDue?.n ?? 0}/${feedAll?.n ?? 0} · cron ${feedCron?.n ?? 0}`,
      `🔔 alert due: ${alertDue?.n ?? 0}/${alertAll?.n ?? 0} · cron ${alertCron?.n ?? 0}`,
      "",
      "<b>Ubah default</b>",
      "<code>/cron set monitor 10</code>",
      "<code>/cron set monitor */10 * * * *</code>",
      "<code>/cron set rss */15 * * * *</code>",
      "<code>/cron set alert 0 * * * *</code>",
      "",
      "<b>Tes ekspresi</b>",
      "<code>/cron test 0 9 * * 1-5</code>",
      "",
      "<i>Per item: buka daftar Monitor/RSS/Alert lalu klik ⏱. Semua jadwal WIB.</i>",
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
