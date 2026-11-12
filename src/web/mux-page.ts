import muxClientCode from "./mux-client.txt";

export interface MuxPageOptions {
  title: string;
  filename: string;
  height: number;
  /** Perkiraan ukuran hasil gabungan dalam byte. */
  size?: number;
  videoUrl: string;
  audioUrl: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Halaman mandiri: mengunduh video (tanpa audio) + audio YouTube lalu
 * menggabungkannya di perangkat user. Tidak ada proses media di sisi server.
 */
export function renderMuxPage(opts: MuxPageOptions): string {
  const script = muxClientCode.replace(/^export /gm, "");
  const size = humanSize(opts.size ? opts.size * 1.02 : undefined);

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)} — ${opts.height}p</title>
<style>
  :root {
    --bg: #0f1115; --card: #171a21; --text: #eceef2; --muted: #9aa3b2;
    --accent: #4f9cf9; --accent-2: #2f7de1; --line: #262b35;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f4f6fa; --card: #ffffff; --text: #16181d; --muted: #5c6472; --line: #e3e7ee; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; background: var(--bg); color: var(--text);
    font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px 18px;
  }
  main { width: 100%; max-width: 460px; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 22px; }
  .badge { display: inline-block; font-size: 12px; letter-spacing: .02em; color: var(--accent); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; margin-bottom: 14px; }
  h1 { font-size: 19px; line-height: 1.35; margin: 0 0 6px; word-break: break-word; }
  p { margin: 0; }
  .meta { color: var(--muted); font-size: 13.5px; }
  .note { color: var(--muted); font-size: 13px; margin-top: 14px; }
  button {
    width: 100%; margin-top: 20px; padding: 13px 16px; font: inherit; font-weight: 600;
    color: #fff; background: linear-gradient(180deg, var(--accent), var(--accent-2));
    border: 0; border-radius: 12px; cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: default; }
  .bar { height: 6px; margin-top: 16px; border-radius: 999px; background: var(--line); overflow: hidden; display: none; }
  .bar span { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s linear; }
  #status { margin-top: 10px; font-size: 13.5px; color: var(--muted); min-height: 20px; }
  #status.error { color: #ff7a7a; }
  .fallback { margin-top: 16px; font-size: 13px; color: var(--muted); display: none; }
  .fallback a { color: var(--accent); }
  ol { padding-left: 18px; margin: 8px 0 0; }
</style>
</head>
<body>
<main>
  <span class="badge">${opts.height}p · dengan suara</span>
  <h1>${escapeHtml(opts.title)}</h1>
  <p class="meta">${size ? `${size} · ` : ""}H.264 + audio AAC</p>

  <button id="go" type="button">Gabungkan &amp; unduh</button>
  <div class="bar" id="bar"><span id="fill"></span></div>
  <div id="status"></div>

  <p class="note">
    Video dan audio diunduh lalu digabung di perangkat ini. Tidak ada file yang disimpan di server.
    Jangan tutup halaman sampai unduhan selesai.
  </p>
  <div class="fallback" id="fallback">
    Kalau unduhan tidak jalan (mis. browser dalam aplikasi):
    <ol>
      <li>Buka halaman ini di Chrome/Safari.</li>
      <li>Atau unduh terpisah: <a id="vlink" href="#">video</a> · <a id="alink" href="#">audio</a>.</li>
    </ol>
  </div>
</main>
<script type="module">
${script}
const VIDEO_URL = ${JSON.stringify(opts.videoUrl)};
const AUDIO_URL = ${JSON.stringify(opts.audioUrl)};
const FILENAME = ${JSON.stringify(opts.filename)};

const button = document.getElementById("go");
const bar = document.getElementById("bar");
const fill = document.getElementById("fill");
const status = document.getElementById("status");
const fallback = document.getElementById("fallback");
document.getElementById("vlink").href = VIDEO_URL;
document.getElementById("alink").href = AUDIO_URL;

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Menyiapkan…";
  bar.style.display = "block";
  status.className = "";
  status.textContent = "Mengunduh video dan audio…";

  // Sumber bisa sesaat membalas 403/5xx (URL media kedaluwarsa lalu di-resolve ulang
  // oleh server), jadi setiap unduhan dicoba beberapa kali sebelum menyerah.
  async function loadMedia(url, label) {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && res.body) return res;
        last = "Sumber " + label + " membalas " + res.status + ".";
        await res.body?.cancel().catch(() => {});
      } catch {
        last = "Koneksi ke sumber " + label + " gagal.";
      }
      if (attempt < 2) status.textContent = "Mencoba ulang " + label + "…";
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    throw new Error(last + " Coba lagi sebentar lagi.");
  }

  try {
    const [videoRes, audioRes] = await Promise.all([
      loadMedia(VIDEO_URL, "video"),
      loadMedia(AUDIO_URL, "audio"),
    ]);

    const parts = [];
    let total = 0;
    for await (const chunk of mergeVideoAudio(videoRes.body, audioRes.body)) {
      parts.push(chunk);
      total += chunk.length;
      fill.style.width = Math.min(96, (total / ${Math.max(opts.size ?? 0, 1)}) * 100) + "%";
      status.textContent = "Menggabungkan… " + mb(total);
    }

    const blob = new Blob(parts, { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();

    fill.style.width = "100%";
    status.textContent = "Selesai: " + mb(blob.size) + " diunduh ke perangkat.";
    button.textContent = "Unduh lagi";
    button.disabled = false;
  } catch (err) {
    status.className = "error";
    status.textContent = err && err.message ? err.message : "Gagal menggabungkan video.";
    fallback.style.display = "block";
    button.textContent = "Coba lagi";
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
}
