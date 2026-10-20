#!/usr/bin/env node
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN wajib diisi.");
  process.exit(1);
}
const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
console.log(JSON.stringify(info, null, 2));
