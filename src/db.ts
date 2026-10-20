import type { Env } from "./env";

/** Run a query and return all rows. */
export async function qAll<T>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = env.DB.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const res = await bound.all<T>();
  return (res.results ?? []) as T[];
}

/** Run a query and return the first row (or null). */
export async function qFirst<T>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  const rows = await qAll<T>(env, sql, ...params);
  return rows[0] ?? null;
}

/** Run a statement that does not need rows back. */
export async function qRun(env: Env, sql: string, ...params: unknown[]): Promise<void> {
  const stmt = env.DB.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  await bound.run();
}

/** Batched writes (single round-trip). */
export async function qBatch(env: Env, statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
  if (!statements.length) return;
  const prepared = statements.map((s) => {
    const stmt = env.DB.prepare(s.sql);
    return s.params?.length ? stmt.bind(...s.params) : stmt;
  });
  await env.DB.batch(prepared);
}
