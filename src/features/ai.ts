import type { Ctx } from "./context";
import { argText } from "./context";
import { qFirst, qRun } from "../db";
import { LIMITS } from "../env";
import {
  chatAction,
  esc,
  getFileBytes,
  sendDocumentBytes,
  sendMessage,
  sendPhotoBytes,
  splitText,
} from "../telegram";
import { getJson, putJson } from "../state";
import { wibDay } from "../time";

const CHAT_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.2-3b-instruct",
];
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const STT_MODEL = "@cf/openai/whisper";

const SYSTEM =
  "Kamu adalah asisten pribadi di Telegram. Jawab dalam bahasa Indonesia yang santai tapi jelas. " +
  "Ringkas, pakai poin kalau perlu. Jangan mengarang fakta.";

async function takeQuota(env: Ctx["env"], userId: number): Promise<number> {
  const day = wibDay();
  const row = await qFirst<{ count: number }>(
    env,
    "SELECT count FROM ai_usage WHERE user_id = ? AND day = ?",
    userId,
    day,
  );
  const used = row?.count ?? 0;
  if (used >= LIMITS.AI_PER_DAY) {
    throw new Error(`Kuota AI harian habis (${LIMITS.AI_PER_DAY} request/hari). Coba lagi besok.`);
  }
  await qRun(
    env,
    `INSERT INTO ai_usage(user_id, day, count) VALUES(?,?,1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`,
    userId,
    day,
  );
  return LIMITS.AI_PER_DAY - used - 1;
}

async function runText(env: Ctx["env"], messages: Array<{ role: string; content: string }>): Promise<string> {
  let lastError: unknown = null;
  for (const model of CHAT_MODELS) {
    try {
      const out: any = await (env.AI as any).run(model, { messages, max_tokens: 900 });
      const text = String(
        out?.response ?? out?.choices?.[0]?.message?.content ?? out?.result?.response ?? "",
      ).trim();
      if (text) return text;
      lastError = new Error(`${model} tidak mengembalikan teks.`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI tidak tersedia saat ini.");
}

async function replyLong(env: Ctx["env"], chatId: number, text: string): Promise<void> {
  for (const chunk of splitText(text)) {
    await sendMessage(env, chatId, esc(chunk));
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function cmdAi(ctx: Ctx): Promise<void> {
  const prompt = argText(ctx);
  if (!prompt) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "🤖 <b>AI Chat</b>\n\n<code>/ai jelaskan apa itu cloudflare workers</code>\n\n" +
        `<i>Kuota ${LIMITS.AI_PER_DAY} request/hari.</i>`,
    );
    return;
  }

  try {
    const left = await takeQuota(ctx.env, ctx.userId);
    await chatAction(ctx.env, ctx.chatId, "typing");

    const key = `ai:${ctx.userId}`;
    const history = (await getJson<Array<{ role: string; content: string }>>(ctx.env, key)) ?? [];
    history.push({ role: "user", content: prompt });

    const answer = await runText(ctx.env, [{ role: "system", content: SYSTEM }, ...history.slice(-8)]);
    history.push({ role: "assistant", content: answer });
    await putJson(ctx.env, key, history.slice(-10), 3600);

    await replyLong(ctx.env, ctx.chatId, answer + `\n\n<i>⚡ Sisa kuota hari ini: ${left}</i>`);
  } catch (err) {
    console.error("ai chat failed", err);
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}

export async function cmdSummarize(ctx: Ctx): Promise<void> {
  const input = argText(ctx);
  if (!input) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "🧾 <b>Ringkas</b>\n\n<code>/ringkas https://contoh.com/artikel</code>\natau reply teks panjang dengan /ringkas",
    );
    return;
  }

  try {
    await chatAction(ctx.env, ctx.chatId, "typing");
    let content = input;
    if (/^https?:\/\//i.test(input)) {
      const res = await fetch(input, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; AdnawaaBot/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Gagal membuka halaman (${res.status}).`);
      content = stripHtml(await res.text()).slice(0, 9000);
      if (content.length < 100) throw new Error("Isi halaman terlalu pendek / tidak bisa dibaca.");
    }

    const left = await takeQuota(ctx.env, ctx.userId);
    const answer = await runText(ctx.env, [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Ringkas teks berikut dalam bahasa Indonesia. Maksimal 7 poin, langsung intinya:\n\n${content.slice(0, 9000)}`,
      },
    ]);
    await replyLong(ctx.env, ctx.chatId, `🧾 <b>Ringkasan</b>\n\n${esc(answer)}\n\n<i>⚡ Sisa kuota: ${left}</i>`);
  } catch (err) {
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}

export async function cmdTranslate(ctx: Ctx): Promise<void> {
  const args = [...ctx.args];
  let lang = "id";
  if (args[0] && /^[a-z]{2}(-[a-z]{2})?$/i.test(args[0]) && args.length > 1) {
    lang = args.shift()!.toLowerCase();
  }
  const text = args.join(" ").trim() || argText(ctx, "");
  if (!text) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "🌐 <b>Terjemah</b>\n\n<code>/tr en selamat pagi</code>\n<code>/tr ja apa kabar</code>\n\nKode bahasa: en, id, ja, ko, ar, zh, es, fr, dll.",
    );
    return;
  }

  try {
    await chatAction(ctx.env, ctx.chatId, "typing");
    const left = await takeQuota(ctx.env, ctx.userId);
    const answer = await runText(ctx.env, [
      { role: "system", content: "Kamu penerjemah profesional. Terjemahkan teks user. Balas hanya hasil terjemahan." },
      { role: "user", content: `Terjemahkan ke bahasa dengan kode "${lang}":\n\n${text}` },
    ]);
    await replyLong(ctx.env, ctx.chatId, `🌐 <b>Terjemahan (${esc(lang)})</b>\n\n${esc(answer)}\n\n<i>⚡ Sisa kuota: ${left}</i>`);
  } catch (err) {
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}

export async function cmdImage(ctx: Ctx): Promise<void> {
  const prompt = argText(ctx);
  if (!prompt) {
    await sendMessage(ctx.env, ctx.chatId, "🎨 <b>Buat Gambar</b>\n\n<code>/img kucing astronot naik roket</code>");
    return;
  }

  try {
    await chatAction(ctx.env, ctx.chatId, "upload_photo");
    const left = await takeQuota(ctx.env, ctx.userId);
    const out: any = await (ctx.env.AI as any).run(IMAGE_MODEL, { prompt });
    const b64 = String(out?.image ?? "");
    if (!b64) throw new Error("AI tidak mengembalikan gambar.");
    const bytes = b64ToBytes(b64);
    await sendPhotoBytes(
      ctx.env,
      ctx.chatId,
      bytes,
      `🎨 <b>${esc(prompt.slice(0, 200))}</b>\n<i>⚡ Sisa kuota: ${left}</i>`,
    );
  } catch (err) {
    console.error("ai image failed", err);
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}

export async function cmdTts(ctx: Ctx): Promise<void> {
  const text = argText(ctx).slice(0, 500);
  if (!text) {
    await sendMessage(ctx.env, ctx.chatId, "🔊 <b>Teks ke Suara</b>\n\n<code>/tts halo semuanya</code>");
    return;
  }

  try {
    await chatAction(ctx.env, ctx.chatId, "record_voice");
    const left = await takeQuota(ctx.env, ctx.userId);
    const out: any = await (ctx.env.AI as any).run(TTS_MODEL, { prompt: text, lang: "en" });
    const b64 = String(out?.audio ?? "");
    if (!b64) throw new Error("AI tidak mengembalikan audio.");
    const bytes = b64ToBytes(b64);
    await sendDocumentBytes(ctx.env, ctx.chatId, bytes, "tts.wav", "audio/wav", {
      caption: `🔊 <b>Teks ke Suara</b>\n<i>⚡ Sisa kuota: ${left}</i>`,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("ai tts failed", err);
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}

export async function cmdStt(ctx: Ctx, fileId?: string): Promise<void> {
  const target = fileId ?? ctx.msg.reply_to_message?.voice?.file_id ?? ctx.msg.reply_to_message?.audio?.file_id;
  if (!target) {
    await sendMessage(ctx.env, ctx.chatId, "📝 Reply voice note / audio dengan <code>/stt</code> untuk transkripsi.");
    return;
  }

  try {
    await chatAction(ctx.env, ctx.chatId, "typing");
    const left = await takeQuota(ctx.env, ctx.userId);
    const file = await getFileBytes(ctx.env, target);
    if (file.bytes.byteLength > 3.5 * 1024 * 1024) {
      throw new Error("Audio terlalu besar untuk transkripsi (maks ±3 MB).");
    }
    const out: any = await (ctx.env.AI as any).run(STT_MODEL, { audio: Array.from(file.bytes) });
    const text = String(out?.text ?? "").trim();
    if (!text) throw new Error("Tidak ada suara yang bisa dikenali.");
    await replyLong(ctx.env, ctx.chatId, `📝 <b>Transkripsi</b>\n\n${esc(text)}\n\n<i>⚡ Sisa kuota: ${left}</i>`);
  } catch (err) {
    await sendMessage(ctx.env, ctx.chatId, `❌ ${esc((err as Error).message)}`);
  }
}
