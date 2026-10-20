import type { Ctx } from "./context";
import { argText } from "./context";
import { qAll, qFirst, qRun } from "../db";
import { esc, sendMessage } from "../telegram";
import { formatWib, parseReminder } from "../time";

interface NoteRow {
  id: number;
  text: string;
  created_at: number;
}
interface TodoRow {
  id: number;
  text: string;
  done: number;
  created_at: number;
}
interface ReminderRow {
  id: number;
  text: string;
  due_at: number;
}

/* ------------------------------- notes ------------------------------- */

export async function cmdNote(ctx: Ctx): Promise<void> {
  const text = argText(ctx);
  if (!text) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/note beli kopi</code>\natau reply pesan dengan /note");
    return;
  }
  await qRun(ctx.env, "INSERT INTO notes(user_id, text, created_at) VALUES(?,?,?)", ctx.userId, text, Date.now());
  await sendMessage(ctx.env, ctx.chatId, `📝 Catatan tersimpan. Lihat dengan /notes`);
}

export async function cmdNotes(ctx: Ctx): Promise<void> {
  const rows = await qAll<NoteRow>(
    ctx.env,
    "SELECT * FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 20",
    ctx.userId,
  );
  if (!rows.length) {
    await sendMessage(ctx.env, ctx.chatId, "📝 Belum ada catatan. Tambah dengan /note &lt;teks&gt;");
    return;
  }
  const lines = ["📝 <b>Catatan kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`<b>#${row.id}</b> ${esc(row.text)}`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `note_del:${row.id}` }]);
  }
  keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function deleteNote(env: Ctx["env"], chatId: number, messageId: number, id: number, userId: number) {
  const row = await qFirst<NoteRow>(env, "SELECT * FROM notes WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return false;
  await qRun(env, "DELETE FROM notes WHERE id = ? AND user_id = ?", id, userId);
  const { editMessage } = await import("../telegram");
  await editMessage(env, chatId, messageId, `🗑 Catatan #${id} dihapus.`, {
    keyboard: { inline_keyboard: [[{ text: "📝 Daftar Catatan", callback_data: "menu:notes" }]] },
  });
  return true;
}

/* -------------------------------- todo ------------------------------- */

export async function cmdTodo(ctx: Ctx): Promise<void> {
  const text = argText(ctx);
  if (!text) {
    await sendMessage(ctx.env, ctx.chatId, "Contoh: <code>/todo bayar listrik</code>");
    return;
  }
  await qRun(ctx.env, "INSERT INTO todos(user_id, text, done, created_at) VALUES(?,?,0,?)", ctx.userId, text, Date.now());
  await sendMessage(ctx.env, ctx.chatId, "✅ Todo ditambahkan. Lihat dengan /todos");
}

export async function cmdTodos(ctx: Ctx): Promise<void> {
  const rows = await qAll<TodoRow>(
    ctx.env,
    "SELECT * FROM todos WHERE user_id = ? ORDER BY done ASC, id DESC LIMIT 20",
    ctx.userId,
  );
  if (!rows.length) {
    await sendMessage(ctx.env, ctx.chatId, "✅ Belum ada todo. Tambah dengan /todo &lt;teks&gt;");
    return;
  }
  const lines = ["✅ <b>Todo kamu</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`${row.done ? "✅" : "⬜"} <b>#${row.id}</b> ${esc(row.text)}`);
    const buttons: any[] = [];
    if (!row.done) buttons.push({ text: `✔️ #${row.id}`, callback_data: `todo_done:${row.id}` });
    buttons.push({ text: `🗑 #${row.id}`, callback_data: `todo_del:${row.id}` });
    keyboard.push(buttons);
  }
  keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function completeTodo(env: Ctx["env"], chatId: number, messageId: number, id: number, userId: number) {
  const row = await qFirst<TodoRow>(env, "SELECT * FROM todos WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return false;
  await qRun(env, "UPDATE todos SET done = 1 WHERE id = ? AND user_id = ?", id, userId);
  const { editMessage } = await import("../telegram");
  await editMessage(env, chatId, messageId, `✅ Todo #${id} selesai: ${esc(row.text)}`, {
    keyboard: { inline_keyboard: [[{ text: "✅ Daftar Todo", callback_data: "menu:todos" }]] },
  });
  return true;
}

export async function deleteTodo(env: Ctx["env"], chatId: number, messageId: number, id: number, userId: number) {
  const row = await qFirst<TodoRow>(env, "SELECT * FROM todos WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return false;
  await qRun(env, "DELETE FROM todos WHERE id = ? AND user_id = ?", id, userId);
  const { editMessage } = await import("../telegram");
  await editMessage(env, chatId, messageId, `🗑 Todo #${id} dihapus.`, {
    keyboard: { inline_keyboard: [[{ text: "✅ Daftar Todo", callback_data: "menu:todos" }]] },
  });
  return true;
}

/* ------------------------------ reminders ---------------------------- */

export async function cmdRemind(ctx: Ctx): Promise<void> {
  const input = argText(ctx);
  if (!input) {
    await sendMessage(
      ctx.env,
      ctx.chatId,
      "⏰ <b>Cara pakai</b>\n\n" +
        "<code>/remind 07:30 sarapan</code>\n" +
        "<code>/remind 2026-10-21 09:00 meeting</code>\n\nWaktu Asia/Jakarta (WIB).",
    );
    return;
  }
  const parsed = parseReminder(input);
  if (!parsed) {
    await sendMessage(ctx.env, ctx.chatId, "❌ Format waktu tidak valid. Contoh: <code>/remind 07:30 sarapan</code>");
    return;
  }
  await qRun(
    ctx.env,
    "INSERT INTO reminders(user_id, chat_id, text, due_at, sent, created_at) VALUES(?,?,?,?,0,?)",
    ctx.userId,
    ctx.chatId,
    parsed.text,
    parsed.dueAt,
    Date.now(),
  );
  await sendMessage(ctx.env, ctx.chatId, `⏰ Pengingat diset untuk <b>${formatWib(parsed.dueAt)}</b>\n\n${esc(parsed.text)}`);
}

export async function cmdReminders(ctx: Ctx): Promise<void> {
  const rows = await qAll<ReminderRow>(
    ctx.env,
    "SELECT * FROM reminders WHERE user_id = ? AND sent = 0 ORDER BY due_at ASC LIMIT 20",
    ctx.userId,
  );
  if (!rows.length) {
    await sendMessage(ctx.env, ctx.chatId, "⏰ Tidak ada pengingat aktif.");
    return;
  }
  const lines = ["⏰ <b>Pengingat aktif</b>", ""];
  const keyboard: any[] = [];
  for (const row of rows) {
    lines.push(`<b>#${row.id}</b> ${formatWib(row.due_at)} — ${esc(row.text)}`);
    keyboard.push([{ text: `🗑 #${row.id}`, callback_data: `rem_del:${row.id}` }]);
  }
  keyboard.push([{ text: "⬅️ Menu Utama", callback_data: "menu:home" }]);
  await sendMessage(ctx.env, ctx.chatId, lines.join("\n"), { keyboard: { inline_keyboard: keyboard } });
}

export async function deleteReminder(
  env: Ctx["env"],
  chatId: number,
  messageId: number,
  id: number,
  userId: number,
) {
  const row = await qFirst<ReminderRow>(env, "SELECT * FROM reminders WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return false;
  await qRun(env, "DELETE FROM reminders WHERE id = ? AND user_id = ?", id, userId);
  const { editMessage } = await import("../telegram");
  await editMessage(env, chatId, messageId, `🗑 Pengingat #${id} dihapus.`, {
    keyboard: { inline_keyboard: [[{ text: "⏰ Daftar Pengingat", callback_data: "menu:reminders" }]] },
  });
  return true;
}
