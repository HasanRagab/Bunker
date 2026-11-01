import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import type { BaseCtx, Middleware } from "../http/router";
import { err, ok, type Result } from "../result";
import * as defaultSchema from "./schema";

export type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export function createDrizzleDatabase(client: Database, options?: { logger?: boolean }):
  BunSQLiteDatabase<typeof defaultSchema.schema> & { $client: Database };
export function createDrizzleDatabase<Schema extends Record<string, unknown>>(
  client: Database,
  options: { schema: Schema; logger?: boolean },
): BunSQLiteDatabase<Schema> & { $client: Database };
export function createDrizzleDatabase(
  client: Database,
  options: { schema?: Record<string, unknown>; logger?: boolean } = {},
): BunSQLiteDatabase<Record<string, unknown>> & { $client: Database } {
  const { schema = defaultSchema.schema, logger = false } = options;
  return drizzle({ client, schema, logger });
}

export function withDrizzleDatabase<DB extends BunSQLiteDatabase<Record<string, unknown>>>(
  db: DB,
): Middleware<BaseCtx, { db: DB }> {
  return () => ({ db });
}

export function migrateDatabase<Schema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<Schema>,
  migrationsFolder: string,
): Result<void, Error> {
  try {
    drizzleMigrate(db, { migrationsFolder });
    return ok(undefined);
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error(String(cause)));
  }
}
