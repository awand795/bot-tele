import type { Env } from "./env";
import type { Media } from "./extract/types";

export type Action =
  | { k: "tb_dl"; share: string; fsId: string; name: string }
  | { k: "tb_send"; share: string; fsId: string; name: string; size?: number }
  | { k: "tb_page"; share: string; dir: string; page: number }
  | { k: "media"; media: Media; caption?: string }
  | { k: "album"; medias: Media[]; caption?: string }
  | { k: "yt_item"; videoId: string }
  | { k: "vault_send"; id: number }
  | { k: "vault_del"; id: number }
  | { k: "note_del"; id: number }
  | { k: "todo_done"; id: number }
  | { k: "todo_del"; id: number }
  | { k: "rem_del"; id: number }
  | { k: "rss_del"; id: number }
  | { k: "mon_del"; id: number }
  | { k: "alert_del"; id: number }
  | { k: "stt"; fileId: string; name?: string };

export type Flow =
  | "idle"
  | "terabox"
  | "sosmed"
  | "youtube"
  | "story"
  | "qr"
  | "weather"
  | "prayer"
  | "currency"
  | "lyrics"
  | "ai"
  | "cari"
  | "paste"
  | "note"
  | "todo"
  | "remind"
  | "rss"
  | "monitor"
  | "alert"
  | "schedule"
  | "ringkas"
  | "tr"
  | "img"
  | "tts";

export type ScheduleKind = "monitor" | "rss" | "alert";

export interface ScheduleTarget {
  kind: ScheduleKind;
  id: number;
}

export interface UserState {
  flow: Flow;
  at: number;
  data?: unknown;
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

export async function setState(
  env: Env,
  userId: number,
  flow: UserState["flow"],
  data?: unknown,
): Promise<void> {
  const value: UserState = { flow, at: Date.now() };
  if (data !== undefined) value.data = data;
  await putJson(env, `st:${userId}`, value, 30 * 60);
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
