import type { Env } from "./env";
import { qAll, qRun } from "./db";
import { sendMessage } from "./telegram";
import { esc } from "./telegram";
import { checkAlerts, checkFeeds, checkMonitors } from "./features/monitor";

interface ReminderRow {
  id: number;
  chat_id: number;
  text: string;
  due_at: number;
}

async function runReminders(env: Env): Promise<void> {
  const rows = await qAll<ReminderRow>(
    env,
    "SELECT * FROM reminders WHERE sent = 0 AND due_at <= ? ORDER BY due_at LIMIT 20",
    Date.now(),
  );

  for (const row of rows) {
    try {
      await sendMessage(env, row.chat_id, `⏰ <b>Pengingat</b>\n\n${esc(row.text)}`);
    } catch (err) {
      console.warn("reminder send failed", row.id, (err as Error).message);
    }
    await qRun(env, "UPDATE reminders SET sent = 1 WHERE id = ?", row.id);
  }
}

/** Entry point for the every-minute cron trigger. */
export async function runCron(env: Env, now = new Date()): Promise<void> {
  // Setiap job memilih item yang sudah jatuh tempo (interval per item di D1).
  // Dengan begitu interval bisa diubah tanpa mengubah jadwal cron Worker.
  const jobs: Array<Promise<void>> = [
    runReminders(env),
    checkMonitors(env),
    checkFeeds(env),
    checkAlerts(env),
  ];

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") console.warn("cron job failed", result.reason);
  }
}
