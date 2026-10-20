import type { Env } from "./env";
import type { Media } from "./extract/types";

export type Action =
  | { k: "tb_dl"; share: string; fsId: string; name: string }
  | { k: "tb_send"; share: string; fsId: string; name: string; size?: number }
  | { k: "tb_page"; share: string; dir: string; page: number }
  | { k: "media"; media: Media; caption?: string }
  | { k: "album"; medias: Media[]; caption?: string };

export interface UserState {
  flow: "terabox" | "sosmed" | "youtube" | "story" | "idle";
  at: number;
}

const TTL = 60 * 60; // 1 hour

export async function getJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.BOT_KV.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function putJson(env: Env, key: string, value: unknown, ttl = TTL): Promise<void> {
  await env.BOT_KV.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

export async function getState(env: Env, userId: number): Promise<UserState | null> {
  return getJson<UserState>(env, `st:${userId}`);
}

export async function setState(env: Env, userId: number, flow: UserState["flow"]): Promise<void> {
  await putJson(env, `st:${userId}`, { flow, at: Date.now() } satisfies UserState, 30 * 60);
}

export async function clearState(env: Env, userId: number): Promise<void> {
  await env.BOT_KV.delete(`st:${userId}`);
}

export async function saveGroup(env: Env, actions: Action[], ttl = TTL): Promise<string> {
  const gid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await putJson(env, `g:${gid}`, actions, ttl);
  return gid;
}

export async function loadGroup(env: Env, gid: string): Promise<Action[] | null> {
  return getJson<Action[]>(env, `g:${gid}`);
}
