export * from "../db/drizzle";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { BaseCtx, Middleware } from "../../http/router";

/**
 * Inject a typed Drizzle database into route context.
 * @example
 * ```ts
 * const router = Router.create().use(withDrizzleDatabase(db));
 * ```
 */
export function withDrizzleDatabase<DB extends BunSQLiteDatabase<Record<string, unknown>>>(
  db: DB,
): Middleware<BaseCtx, { db: DB }> {
  return () => ({ db });
}
