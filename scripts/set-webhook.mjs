#!/usr/bin/env node
/**
 * Register the Telegram webhook.
 *
 * Usage (PowerShell):
 *   $env:BOT_TOKEN="123:abc"; $env:WEBHOOK_SECRET="..."; $env:PUBLIC_URL="https://bot-tele.awand795.workers.dev"
 *   node scripts/set-webhook.mjs
 */
const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const base = process.env.PUBLIC_URL;

if (!token || !secret || !base) {
  console.error("BOT_TOKEN, WEBHOOK_SECRET dan PUBLIC_URL wajib diisi.");
  process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/tg/${secret}`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
    max_connections: 40,
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!data.ok) process.exit(1);

const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
console.log(JSON.stringify(info, null, 2));
