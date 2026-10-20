import type { Env } from "./env";
import { handleUpdate } from "./router";
import { verifyPayload } from "./crypto";
import { isMediaContentType, resolveStream, type StreamPayload } from "./resolve";
import { detectPlatform, extractMedia } from "./extract";
import { browseTeraBox, normalizeShare } from "./extract/terabox";
import { signedMediaUrl, deliverMedia } from "./sender";
import { runCron } from "./cron";
import { servePaste } from "./features/tools";
import { checkAlerts, checkFeeds, checkMonitors, handleGithubWebhook } from "./features/monitor";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").slice(0, 120) || "file";
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("bot-tele is running", { headers: { "Content-Type": "text/plain" } });
    }

    if (url.pathname.startsWith("/p/")) {
      return servePaste(env, url.pathname.slice(3));
    }

    if (url.pathname.startsWith("/gh/")) {
      if (url.pathname.slice(4) !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return handleGithubWebhook(env, request);
    }

    if (url.pathname.startsWith("/tg/")) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const secret = url.pathname.slice("/tg/".length);
      if (secret !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const headerSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (headerSecret && headerSecret !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });

      let update: any;
      try {
        update = await request.json();
      } catch {
        return new Response("Bad request", { status: 400 });
      }

      // Deduplicate retries: Telegram re-sends an update when our response is slow.
      const dedupeKey = `upd:${update?.update_id ?? "x"}`;
      try {
        if (await env.BOT_KV.get(dedupeKey)) return new Response("ok");
        await env.BOT_KV.put(dedupeKey, "1", { expirationTtl: 300 });
      } catch {
        /* continue even if KV hiccups */
      }

      try {
        await handleUpdate(env, update, origin);
      } catch (err) {
        console.error("update failed", err);
      }
      return new Response("ok");
    }

    if (url.pathname.startsWith("/dl/")) {
      const token = url.pathname.slice("/dl/".length);
      const payload = await verifyPayload(env, token);
      if (!payload) return new Response("Link kedaluwarsa.", { status: 410 });

      try {
        const streamPayload = payload as unknown as StreamPayload;
        const resolved = await resolveStream(env, streamPayload, request.headers.get("Range"));
        if (!resolved.response.ok && resolved.response.status !== 206) {
          await resolved.response.body?.cancel().catch(() => {});
          return new Response(`Gagal mengambil file (upstream ${resolved.response.status}).`, { status: 502 });
        }
        if (!isMediaContentType(streamPayload.kind, resolved.contentType)) {
          await resolved.response.body?.cancel().catch(() => {});
          return new Response(
            `Sumber mengirim ${resolved.contentType || "respons tak dikenal"}, bukan media.`,
            { status: 502 },
          );
        }

        const headers = new Headers();
        headers.set("Content-Type", resolved.contentType);
        headers.set("Accept-Ranges", resolved.response.headers.get("accept-ranges") ?? "bytes");
        headers.set("Cache-Control", "private, max-age=3600");
        headers.set(
          "Content-Disposition",
          `inline; filename="${asciiFilename(resolved.filename)}"; filename*=UTF-8''${encodeURIComponent(resolved.filename)}`,
        );

        const length = resolved.response.headers.get("content-length");
        if (length) headers.set("Content-Length", length);
        const range = resolved.response.headers.get("content-range");
        if (range) headers.set("Content-Range", range);

        const status = resolved.response.status === 206 ? 206 : 200;
        if (request.method === "HEAD") return new Response(null, { status, headers });
        return new Response(resolved.response.body, { status, headers });
      } catch (err) {
        console.error("proxy failed", err);
        return new Response("Gagal mengambil file dari sumber.", { status: 502 });
      }
    }

    if (url.pathname === "/_link") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "url wajib" }, 400);
      try {
        const result = await extractMedia(env, target);
        const media = url.searchParams.get("mode") === "audio" ? result.extras[0] ?? result.medias[0] : result.medias[0];
        const signed = await signedMediaUrl(env, origin, media, 600);
        return json({ kind: media.kind, filename: media.filename, size: media.size, signed });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/_chats") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const listing = await env.BOT_KV.list({ prefix: "chat:" });
      const chats: unknown[] = [];
      for (const key of listing.keys) {
        const raw = await env.BOT_KV.get(key.name);
        if (raw) {
          try {
            chats.push(JSON.parse(raw));
          } catch {
            /* skip */
          }
        }
      }
      return json(chats);
    }

    if (url.pathname === "/_send") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const chat = url.searchParams.get("chat");
      const target = url.searchParams.get("url");
      if (!chat || !target) return json({ error: "chat & url wajib" }, 400);
      try {
        const result = await extractMedia(env, target);
        const media =
          url.searchParams.get("mode") === "audio" ? result.extras[0] ?? result.medias[0] : result.medias[0];
        const delivered = await deliverMedia(env, origin, chat, media, result.caption);
        return json({ ok: true, mode: delivered.mode, kind: media.kind, size: media.size });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/_probe") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "url wajib" }, 400);
      const method = url.searchParams.get("method") ?? "GET";
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(url.searchParams.get("headers") ?? "{}");
      } catch {
        return json({ error: "headers bukan JSON valid" }, 400);
      }
      const body = url.searchParams.get("body") ?? undefined;
      try {
        const res = await fetch(target, { method, headers, body });
        const text = await res.text();
        return json({
          status: res.status,
          contentType: res.headers.get("content-type"),
          server: res.headers.get("server"),
          body: text.slice(0, 1500),
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/_cron") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const job = url.searchParams.get("job") ?? "all";
      try {
        if (job === "feeds") await checkFeeds(env);
        else if (job === "monitors") await checkMonitors(env);
        else if (job === "alerts") await checkAlerts(env);
        else await runCron(env);
        return json({ ok: true, job });
      } catch (err) {
        return json({ ok: false, job, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/_ai") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const model = url.searchParams.get("model") ?? "@cf/meta/llama-3.1-8b-instruct";
      const prompt = url.searchParams.get("prompt") ?? "halo";
      try {
        let inputs: unknown;
        if (model.includes("flux")) inputs = { prompt };
        else if (model.includes("melotts")) inputs = { prompt, lang: "en" };
        else if (model.includes("whisper")) inputs = { audio: [] };
        else inputs = { messages: [{ role: "user", content: prompt }], max_tokens: 200 };

        const out: any = await (env.AI as any).run(model, inputs);
        const summary: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(out ?? {})) {
          if (typeof value === "string") summary[key] = { length: value.length, preview: value.slice(0, 120) };
          else summary[key] = value;
        }
        return json({ ok: true, model, summary });
      } catch (err) {
        return json({ ok: false, model, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/_debug") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const target = url.searchParams.get("url") ?? "";
      const platform = detectPlatform(target);
      if (!platform) return json({ error: "platform tidak dikenali" }, 400);

      try {
        if (platform === "terabox") {
          const share = normalizeShare(target);
          if (!share) throw new Error("link terabox tidak valid");
          const browse = await browseTeraBox(env, share, "/", 1);
          return json({
            platform,
            share,
            title: browse.title,
            dirs: browse.dirs,
            files: browse.files.map((f) => ({
              fs_id: f.fs_id,
              name: f.server_filename,
              size: f.size,
              size_h: f.size_h,
            })),
            has_more: browse.has_more,
            page: browse.page,
          });
        }

        const result = await extractMedia(env, target);
        return json({
          platform: result.platform,
          title: result.title,
          mediaCount: result.medias.length,
          medias: result.medias.map((m) => ({
            kind: m.kind,
            filename: m.filename,
            size: m.size,
            duration: m.duration,
            url: m.url.slice(0, 140),
          })),
          extras: result.extras.map((m) => ({ kind: m.kind, filename: m.filename, size: m.size })),
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};
