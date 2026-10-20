import type { Env } from "./env";
import { LIMITS } from "./env";

export interface RateResult {
  ok: boolean;
  used: number;
  limit: number;
  resetInMinutes: number;
}

export async function checkRate(env: Env, userId: number, limit = LIMITS.RATE_PER_HOUR): Promise<RateResult> {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  const key = `rl:${userId}:${hour}`;
  const current = parseInt((await env.BOT_KV.get(key)) ?? "0", 10) || 0;
  if (current >= limit) {
    const resetInMinutes = Math.max(1, Math.ceil(((hour + 1) * 3_600_000 - now) / 60_000));
    return { ok: false, used: current, limit, resetInMinutes };
  }
  await env.BOT_KV.put(key, String(current + 1), { expirationTtl: 3700 });
  return { ok: true, used: current + 1, limit, resetInMinutes: 60 };
}
