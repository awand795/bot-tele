import type { Env } from "../env";
import type { TgMessage } from "../types";

export interface Ctx {
  env: Env;
  origin: string;
  chatId: number;
  userId: number;
  msg: TgMessage;
  text: string;
  args: string[];
}

export function argText(ctx: Ctx, fallback = ""): string {
  const joined = ctx.args.join(" ").trim();
  if (joined) return joined;
  const reply = (ctx.msg as any).reply_to_message?.text;
  return typeof reply === "string" ? reply.trim() : fallback;
}
