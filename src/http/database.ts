import { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { BaseCtx, Middleware } from "./router";

export function withDatabase(db: Database): Middleware<BaseCtx, { db: Database }> {
  return () => ({ db });
}

export function withDrizzleDatabase<DB extends BunSQLiteDatabase<Record<string, unknown>>>(
  db: DB,
): Middleware<BaseCtx, { db: DB }> {
  return () => ({ db });
}
