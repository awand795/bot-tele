import type { Env } from "../env";

export const TB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const ORIGIN = "https://www.terabox.com";

export interface TbFile {
  fs_id: string | number;
  server_filename: string;
  path?: string;
  size?: number;
  size_h?: string;
  is_dir?: boolean;
  category?: string;
}

export interface TbBrowse {
  ok: boolean;
  title?: string;
  dir: string;
  dirs: TbFile[];
  files: TbFile[];
  has_more: boolean;
  page: number;
  file_count?: number;
  dir_count?: number;
}

export interface TbDownload {
  ok: boolean;
  url: string;
  filename: string;
  size?: number;
  size_h?: string;
  expires_in_s: number;
}

const SHARE_HOSTS = [
  "terabox.com",
  "www.terabox.com",
  "1024terabox.com",
  "www.1024terabox.com",
  "1024tera.com",
  "www.1024tera.com",
  "terabox.app",
  "www.terabox.app",
  "teraboxapp.com",
  "www.teraboxapp.com",
  "4funbox.com",
  "www.4funbox.com",
  "4funbox.co",
  "mirrobox.com",
  "www.mirrobox.com",
  "nephobox.com",
  "www.nephobox.com",
  "momerybox.com",
  "www.momerybox.com",
  "tibibox.com",
  "www.tibibox.com",
  "freeterabox.com",
  "www.freeterabox.com",
];

export function isTeraboxUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return SHARE_HOSTS.includes(u.hostname.toLowerCase()) && /\/s\//.test(u.pathname);
  } catch {
    return false;
  }
}

export function normalizeShare(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{10,40}$/.test(trimmed) && !trimmed.includes(".")) {
    return `https://www.terabox.com/s/${trimmed}`;
  }
  try {
    const u = new URL(trimmed);
    if (!/\/s\//.test(u.pathname)) return null;
    const surl = u.pathname.split("/s/")[1]?.split("/")[0];
    if (!surl) return null;
    let out = `https://www.terabox.com/s/${surl}`;
    const pwd = u.searchParams.get("pwd");
    if (pwd) out += `?pwd=${encodeURIComponent(pwd)}`;
    return out;
  } catch {
    return null;
  }
}

function surlOf(share: string): string | null {
  try {
    return new URL(share).pathname.split("/s/")[1]?.split("/")[0] ?? null;
  } catch {
    return null;
  }
}

function pwdOf(share: string): string | undefined {
  try {
    return new URL(share).searchParams.get("pwd") ?? undefined;
  } catch {
    return undefined;
  }
}

export class TeraBoxAuthError extends Error {
  constructor(
    message = "TeraBox butuh cookie akun untuk link ini. Set secret TERABOX_COOKIE (lihat README).",
  ) {
    super(message);
    this.name = "TeraBoxAuthError";
  }
}

interface Session {
  jsToken: string;
  cookie: string;
}

async function openSession(env: Env, share: string): Promise<Session> {
  const surl = surlOf(share);
  if (!surl) throw new Error("Link TeraBox tidak valid.");

  const pageUrl = `${ORIGIN}/sharing/link?surl=${surl}${pwdOf(share) ? `&pwd=${pwdOf(share)}` : ""}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": TB_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  const html = await res.text();

  const jsToken = html.match(/fn%28%22([A-F0-9]{40,})%22%29/)?.[1] ?? "";
  const setCookie = res.headers.get("set-cookie") ?? "";
  const anonCookie = setCookie.split(";")[0]?.trim();

  const parts = [env.TERABOX_COOKIE?.trim(), anonCookie, jsToken ? `jsToken=${jsToken}` : ""].filter(
    (v): v is string => Boolean(v && v.length > 3),
  );

  return { jsToken, cookie: parts.join("; ") };
}

function commonParams(session: Session): Record<string, string> {
  return {
    app_id: "250528",
    web: "1",
    channel: "dubox",
    clienttype: "0",
    jsToken: session.jsToken,
    "dp-logid": `0${Date.now()}0001`,
  };
}

async function getJson(url: string, session: Session): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": TB_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${ORIGIN}/`,
      Cookie: session.cookie,
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`TeraBox membalas ${res.status} dengan format tak dikenal.`);
  }
}

function assertOk(json: any, fallback: string): void {
  if (json?.errno === 0 || json?.errno === "0" || json?.errno === undefined) return;
  if (json.errno === 400210 || json.errno === 400141) {
    throw new TeraBoxAuthError();
  }
  throw new Error(json.errmsg || `${fallback} (errno ${json.errno})`);
}

interface RootInfo {
  shareid: string;
  uk: string;
  sign: string;
  timestamp: string;
  list: TbFile[];
  title?: string;
}

const rootCache = new Map<string, { at: number; info: RootInfo }>();

async function getRoot(env: Env, share: string, force = false): Promise<RootInfo> {
  const cached = rootCache.get(share);
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached.info;

  const session = await openSession(env, share);
  const surl = surlOf(share)!;
  const params = new URLSearchParams({
    ...commonParams(session),
    shorturl: surl.replace(/^1/, ""),
    root: "1",
  });
  if (pwdOf(share)) params.set("pwd", pwdOf(share)!);

  const json = await getJson(`${ORIGIN}/api/shorturlinfo?${params.toString()}`, session);
  assertOk(json, "Gagal membaca link TeraBox");

  const info: RootInfo = {
    shareid: String(json.shareid ?? ""),
    uk: String(json.uk ?? ""),
    sign: String(json.sign ?? ""),
    timestamp: String(json.timestamp ?? ""),
    list: Array.isArray(json.list) ? json.list : [],
    title: json.title,
  };

  if (!info.shareid) throw new TeraBoxAuthError("TeraBox menolak permintaan. Cookie akun mungkin sudah kedaluwarsa.");
  rootCache.set(share, { at: Date.now(), info });
  return info;
}

export async function browseTeraBox(env: Env, share: string, dir = "/", page = 1): Promise<TbBrowse> {
  const root = await getRoot(env, share);
  const session = await openSession(env, share);
  const surl = surlOf(share)!;

  let items: TbFile[];
  if (dir === "/" || !dir) {
    items = root.list;
  } else {
    const params = new URLSearchParams({
      ...commonParams(session),
      shorturl: surl.replace(/^1/, ""),
      root: "0",
      dir,
      page: String(page),
      num: "100",
      order: "time",
      desc: "1",
    });
    const json = await getJson(`${ORIGIN}/share/list?${params.toString()}`, session);
    assertOk(json, "Gagal membaca folder TeraBox");
    items = Array.isArray(json.list) ? json.list : [];
  }

  const dirs = items.filter((it) => it.is_dir);
  const files = items.filter((it) => !it.is_dir);

  return {
    ok: true,
    title: root.title || items[0]?.path || "TeraBox",
    dir,
    dirs,
    files,
    has_more: false,
    page,
    file_count: files.length,
    dir_count: dirs.length,
  };
}

export async function getTeraBoxDownload(env: Env, share: string, fsId: string | number): Promise<TbDownload> {
  const root = await getRoot(env, share);
  const session = await openSession(env, share);

  const params = new URLSearchParams({
    ...commonParams(session),
    shareid: root.shareid,
    uk: root.uk,
    sign: root.sign,
    timestamp: root.timestamp,
    primaryid: root.shareid,
    product: "share",
    nozip: "0",
    fid_list: `[${fsId}]`,
  });

  const json = await getJson(`${ORIGIN}/share/download?${params.toString()}`, session);
  assertOk(json, "Gagal membuat link download TeraBox");

  const dlink: string | undefined = json.dlink;
  if (!dlink) throw new TeraBoxAuthError("TeraBox tidak memberi link download. Coba cookie akun yang lain.");

  // Resolve the redirect chain once, so the returned URL works without cookies.
  let finalUrl = dlink;
  try {
    const res = await fetch(dlink, {
      headers: { "User-Agent": TB_UA, Cookie: session.cookie, Referer: `${ORIGIN}/` },
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (location) finalUrl = new URL(location, dlink).toString();
  } catch {
    /* keep dlink */
  }

  const item = root.list.find((f) => String(f.fs_id) === String(fsId));
  return {
    ok: true,
    url: finalUrl,
    filename: item?.server_filename || `terabox_${fsId}`,
    size: item?.size ? Number(item.size) : undefined,
    size_h: item?.size_h,
    expires_in_s: 3600,
  };
}
