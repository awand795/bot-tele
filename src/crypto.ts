import type { Env } from "./env";

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function getKey(env: Env): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === env.WEBHOOK_SECRET) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedKey = { secret: env.WEBHOOK_SECRET, key };
  return key;
}

export async function signPayload(env: Env, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = { ...payload, e: Math.floor(Date.now() / 1000) + ttlSeconds };
  const b64 = b64url(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await getKey(env), enc.encode(b64));
  return `${b64}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyPayload(env: Env, token: string): Promise<Record<string, any> | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const ok = await crypto.subtle.verify("HMAC", await getKey(env), unb64url(sig), enc.encode(b64));
  if (!ok) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(unb64url(b64)));
    if (typeof json.e !== "number" || json.e < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

export function randomId(len = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", enc.encode(text));
  return b64url(new Uint8Array(digest)).slice(0, 16);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return b64url(new Uint8Array(digest)).slice(0, 22);
}
