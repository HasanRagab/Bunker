import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { err, ok, type Result } from "../../core/result";

/**
 * Drizzle Bun SQLite database type exposed by the optional adapter.
 * @example
 * ```ts
 * const db: BunSQLiteDatabase<typeof schema> = createDrizzleDatabase(client, { schema });
 * ```
 */
export type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/**
 * Create a typed Drizzle client over a Bun SQLite database.
 * @example
 * ```ts
 * const db = createDrizzleDatabase(client, { schema: { users } });
 * ```
 */
export function createDrizzleDatabase<Schema extends Record<string, unknown> = Record<string, never>>(
  client: Database,
  options?: { schema?: Schema; logger?: boolean },
): BunSQLiteDatabase<Schema> & { $client: Database };
/**
 * Runtime implementation for {@link createDrizzleDatabase}.
 * @example
 * ```ts
 * const db = createDrizzleDatabase(client);
 * ```
 */
export function createDrizzleDatabase(
  client: Database,
  options: { schema?: Record<string, unknown>; logger?: boolean } = {},
): BunSQLiteDatabase<Record<string, unknown>> & { $client: Database } {
  const { schema, logger = false } = options;
  return drizzle({ client, ...(schema === undefined ? {} : { schema }), logger });
}

/**
 * Apply Drizzle SQL migrations and return migration failures as `Result`.
 * @example
 * ```ts
 * const migrated = migrateDatabase(db, "./drizzle");
 * ```
 */
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
