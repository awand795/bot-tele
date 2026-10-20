import type { Ctx } from "./context";
import { argText } from "./context";
import { qFirst, qRun } from "../db";
import { esc, sendMediaByUrl, sendMessage, splitText } from "../telegram";
import { randomId } from "../crypto";

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function weatherText(code: number): string {
  if (code === 0) return "☀️ Cerah";
  if (code <= 3) return "🌤 Cerah berawan";
  if (code === 45 || code === 48) return "🌫 Berkabut";
  if (code >= 51 && code <= 57) return "🌦 Gerimis";
  if (code >= 61 && code <= 67) return "🌧 Hujan";
  if (code >= 71 && code <= 77) return "🌨 Salju";
  if (code >= 80 && code <= 82) return "🌧 Hujan lokal";
  if (code >= 85 && code <= 86) return "🌨 Hujan salju";
  if (code >= 95) return "⛈ Badai petir";
  return "🌡 Cuaca";
}

interface Geo {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

async function geocode(query: string): Promise<Geo | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query,
  )}&count=1&language=id&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json: any = await res.json();
  return json?.results?.[0] ?? null;
}

export async function cmdQr(ctx: Ctx): Promise<void> {
  const text = argText(ctx);
  if (!text) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/qr https://example.com</code>");
    return;
  }
  if (text.length > 900) {
    await sendMessage(ctx.env, ctx.chatId, "Teks terlalu panjang untuk QR (maks 900 karakter).");
    return;
  }
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=700x700&margin=12&data=${encodeURIComponent(text)}`;
  await sendMediaByUrl(ctx.env, ctx.chatId, {
    kind: "photo",
    url,
    caption: `🔳 <b>QR Code</b>\n<code>${esc(text.slice(0, 200))}</code>`,
  });
}

export async function cmdWeather(ctx: Ctx): Promise<void> {
  const city = argText(ctx);
  if (!city) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/cuaca Jakarta</code>");
    return;
  }
  const geo = await geocode(city);
  if (!geo) {
    await sendMessage(ctx.env, ctx.chatId, `❌ Kota <b>${esc(city)}</b> tidak ditemukan.`);
    return;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=auto&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo membalas ${res.status}`);
  const json: any = await res.json();
  const cur = json.current;
  const daily = json.daily;

  const lines: string[] = [
    `🌤 <b>Cuaca ${esc(geo.name)}</b>`,
    `📍 ${esc([geo.admin1, geo.country].filter(Boolean).join(", "))}`,
    "",
    `<b>Sekarang</b> ${weatherText(Number(cur.weather_code))}`,
    `🌡 ${cur.temperature_2m}°C (terasa ${cur.apparent_temperature}°C)`,
    `💧 ${cur.relative_humidity_2m}% · 🌬 ${cur.wind_speed_10m} km/j · 🌧 ${cur.precipitation} mm`,
    "",
    "<b>3 hari</b>",
  ];

  for (let i = 0; i < (daily?.time?.length ?? 0); i++) {
    const d = new Date(`${daily.time[i]}T00:00:00Z`);
    lines.push(
      `• ${DAYS[d.getUTCDay()]} ${daily.time[i].slice(8, 10)}/${daily.time[i].slice(5, 7)}: ` +
        `${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C, ` +
        `hujan ${daily.precipitation_probability_max[i] ?? 0}%`,
    );
  }

  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"));
}

export async function cmdPrayer(ctx: Ctx): Promise<void> {
  const city = argText(ctx);
  if (!city) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/sholat Bandung</code>");
    return;
  }
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=20`;
  const res = await fetch(url);
  const json: any = await res.json();
  if (!json?.data?.timings) {
    await sendMessage(ctx.env, ctx.chatId, `❌ Jadwal sholat untuk <b>${esc(city)}</b> tidak ditemukan.`);
    return;
  }
  const t = json.data.timings;
  const clean = (v: string) => String(v).split(" ")[0];
  const date = json.data.date?.readable ?? "";

  const text =
    `🕌 <b>Jadwal Sholat — ${esc(city)}</b>\n` +
    `📅 ${esc(date)}\n\n` +
    `Subuh    <b>${clean(t.Fajr)}</b>\n` +
    `Dzuhur   <b>${clean(t.Dhuhr)}</b>\n` +
    `Ashar    <b>${clean(t.Asr)}</b>\n` +
    `Maghrib  <b>${clean(t.Maghrib)}</b>\n` +
    `Isya     <b>${clean(t.Isha)}</b>\n\n` +
    `<i>Sumber: Aladhan (Kemenag)</i>`;
  await sendMessage(ctx.env, ctx.chatId, text);
}

export async function cmdCurrency(ctx: Ctx): Promise<void> {
  const parts = ctx.args.map((p) => p.trim()).filter(Boolean);
  let amount = 1;
  let from = "USD";
  let to = "IDR";

  if (parts.length === 1) {
    from = parts[0].toUpperCase();
  } else if (parts.length === 2) {
    if (/^\d+(\.\d+)?$/.test(parts[0])) {
      amount = Number(parts[0]);
      from = parts[1].toUpperCase();
    } else {
      from = parts[0].toUpperCase();
      to = parts[1].toUpperCase();
    }
  } else if (parts.length >= 3) {
    amount = Number(parts[0]) || 1;
    from = parts[1].toUpperCase();
    to = parts[2].toUpperCase();
  }

  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
  const json: any = await res.json();
  const rate = json?.rates?.[to];
  if (!rate) {
    await sendMessage(ctx.env, ctx.chatId, `❌ Kurs <b>${esc(from)} → ${esc(to)}</b> tidak tersedia.`);
    return;
  }

  const result = amount * Number(rate);
  const fmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
  const updated = json.time_last_update_utc ? `\n\n<i>Update: ${esc(json.time_last_update_utc)}</i>` : "";
  await sendMessage(
    ctx.env,
    ctx.chatId,
    `💱 <b>Kurs</b>\n\n${fmt.format(amount)} ${esc(from)} = <b>${fmt.format(result)} ${esc(to)}</b>` +
      `\n1 ${esc(from)} = ${fmt.format(Number(rate))} ${esc(to)}${updated}`,
  );
}

export async function cmdLyrics(ctx: Ctx): Promise<void> {
  const query = argText(ctx);
  if (!query) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/lirik perfect ed sheeran</code>");
    return;
  }

  const suggestRes = await fetch(`https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`);
  const suggest: any = await suggestRes.json();
  const first = suggest?.data?.[0];
  if (!first?.title || !first?.artist?.name) {
    await sendMessage(ctx.env, ctx.chatId, `❌ Lagu <b>${esc(query)}</b> tidak ditemukan.`);
    return;
  }

  const lyricsRes = await fetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(first.artist.name)}/${encodeURIComponent(first.title)}`,
  );
  const lyricsJson: any = await lyricsRes.json();
  const lyrics = String(lyricsJson?.lyrics ?? "").trim();
  if (!lyrics) {
    await sendMessage(ctx.env, ctx.chatId, "❌ Lirik tidak tersedia untuk lagu itu.");
    return;
  }

  const header = `🎵 <b>${esc(first.title)}</b>\n${esc(first.artist.name)}\n\n`;
  const chunks = splitText(lyrics, 3500);
  for (let i = 0; i < chunks.length; i++) {
    await sendMessage(ctx.env, ctx.chatId, esc((i === 0 ? header : "") + chunks[i]));
  }
}

export async function cmdPaste(ctx: Ctx): Promise<void> {
  const text = argText(ctx);
  if (!text) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/paste teks apa saja</code>\natau reply pesan dengan /paste");
    return;
  }
  const slug = randomId(7);
  const now = Date.now();
  await qRun(
    ctx.env,
    "INSERT INTO pastes(slug, user_id, text, created_at, expires_at) VALUES(?,?,?,?,?)",
    slug,
    ctx.userId,
    text,
    now,
    now + 30 * 24 * 3600 * 1000,
  );
  const url = `${ctx.origin}/p/${slug}`;
  await sendMessage(ctx.env, ctx.chatId, `📋 <b>Paste tersimpan</b>\n\n<a href="${url}">${url}</a>\n\n<i>Berlaku 30 hari.</i>`, {
    keyboard: { inline_keyboard: [[{ text: "🔗 Buka", url }]] },
    disablePreview: false,
  });
}

export async function cmdGetPaste(ctx: Ctx): Promise<void> {
  const slug = ctx.args[0];
  if (!slug) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/get abc1234</code>");
    return;
  }
  const row = await qFirst<{ text: string; expires_at: number | null }>(
    ctx.env,
    "SELECT text, expires_at FROM pastes WHERE slug = ?",
    slug,
  );
  if (!row || (row.expires_at && row.expires_at < Date.now())) {
    await sendMessage(ctx.env, ctx.chatId, "❌ Paste tidak ditemukan atau sudah kedaluwarsa.");
    return;
  }
  for (const chunk of splitText(row.text)) {
    await sendMessage(ctx.env, ctx.chatId, `<pre>${esc(chunk)}</pre>`);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function servePaste(env: import("../env").Env, slug: string): Promise<Response> {
  const row = await qFirst<{ text: string; expires_at: number | null }>(
    env,
    "SELECT text, expires_at FROM pastes WHERE slug = ?",
    slug,
  );
  if (!row) {
    return new Response("Paste tidak ditemukan.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (row.expires_at && row.expires_at < Date.now()) {
    return new Response("Paste sudah kedaluwarsa.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paste ${escapeHtml(slug)}</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0b0d10;color:#e6e6e6;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#8b93a1;font-weight:600}
pre{white-space:pre-wrap;word-break:break-word;background:#12151a;border:1px solid #232833;border-radius:12px;padding:18px;overflow:auto}
footer{margin-top:24px;color:#6b7280;font-size:12px}
</style></head>
<body><main><h1>Paste ${escapeHtml(slug)}</h1><pre>${escapeHtml(row.text)}</pre>
<footer>Dibuat lewat bot Telegram · kedaluwarsa otomatis</footer></main></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
