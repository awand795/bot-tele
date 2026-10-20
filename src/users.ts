import type { Env } from "./env";
import type { TgUser } from "./types";
import { qFirst, qRun } from "./db";

export type Role = "owner" | "member" | "pending" | "blocked";

export interface UserRow {
  id: number;
  username: string | null;
  first_name: string | null;
  role: Role;
  created_at: number;
}

export async function touchUser(env: Env, from: TgUser): Promise<UserRow> {
  const existing = await qFirst<UserRow>(env, "SELECT * FROM users WHERE id = ?", from.id);
  if (existing) {
    await qRun(
      env,
      "UPDATE users SET username = ?, first_name = ? WHERE id = ?",
      from.username ?? null,
      from.first_name ?? null,
      from.id,
    );
    return existing;
  }

  const count = await qFirst<{ n: number }>(env, "SELECT COUNT(*) AS n FROM users");
  const role: Role = (count?.n ?? 0) === 0 ? "owner" : "pending";
  const now = Date.now();
  await qRun(
    env,
    "INSERT INTO users(id, username, first_name, role, created_at) VALUES(?,?,?,?,?)",
    from.id,
    from.username ?? null,
    from.first_name ?? null,
    role,
    now,
  );
  return { id: from.id, username: from.username ?? null, first_name: from.first_name ?? null, role, created_at: now };
}

export async function isAllowed(env: Env, user: UserRow): Promise<boolean> {
  if (user.role === "owner" || user.role === "member") return true;
  if (user.role === "blocked") return false;
  const setting = await qFirst<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'allow_all'");
  return setting?.value === "1";
}

export async function getOwner(env: Env): Promise<UserRow | null> {
  return qFirst<UserRow>(env, "SELECT * FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1");
}

export async function setRole(env: Env, id: number, role: Role): Promise<boolean> {
  const user = await qFirst<{ id: number }>(env, "SELECT id FROM users WHERE id = ?", id);
  if (!user) return false;
  await qRun(env, "UPDATE users SET role = ? WHERE id = ?", role, id);
  return true;
}

export async function listUsers(env: Env, limit = 30): Promise<UserRow[]> {
  return env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ?").bind(limit).all<UserRow>().then(
    (r) => (r.results ?? []) as UserRow[],
  );
}

export async function getSetting(env: Env, key: string): Promise<string> {
  const row = await qFirst<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", key);
  return row?.value ?? "";
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await qRun(
    env,
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
