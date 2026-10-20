import type { Env } from "./env";
import { qRun } from "./db";
import { wibDay } from "./time";

export async function bump(env: Env, feature: string): Promise<void> {
  try {
    await qRun(
      env,
      `INSERT INTO stats(day, feature, count) VALUES(?, ?, 1)
       ON CONFLICT(day, feature) DO UPDATE SET count = count + 1`,
      wibDay(),
      feature,
    );
  } catch {
    /* stats must never break a request */
  }
}

export async function logAudit(env: Env, userId: number, action: string, meta?: string): Promise<void> {
  try {
    await qRun(
      env,
      "INSERT INTO audit(user_id, action, meta, created_at) VALUES(?,?,?,?)",
      userId,
      action,
      meta ?? null,
      Date.now(),
    );
  } catch {
    /* audit must never break a request */
  }
}
