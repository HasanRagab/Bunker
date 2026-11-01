import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { err, ok, type Result } from "../../core/result";

export type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export function createDrizzleDatabase<Schema extends Record<string, unknown> = Record<string, never>>(
  client: Database,
  options?: { schema?: Schema; logger?: boolean },
): BunSQLiteDatabase<Schema> & { $client: Database };
export function createDrizzleDatabase(
  client: Database,
  options: { schema?: Record<string, unknown>; logger?: boolean } = {},
): BunSQLiteDatabase<Record<string, unknown>> & { $client: Database } {
  const { schema, logger = false } = options;
  return drizzle({ client, ...(schema === undefined ? {} : { schema }), logger });
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
