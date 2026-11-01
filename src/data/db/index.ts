import { Database, type SQLQueryBindings } from "bun:sqlite";
import { z } from "zod";
import { err, ok, type Result } from "../result";
import type { BaseCtx, Middleware } from "../http/router";

export type DbError = Error;

export function openDatabase(path = ":memory:"): Result<Database, DbError> {
  try {
    return ok(new Database(path, { create: true, strict: true }));
  } catch (cause) {
    return err(asError(cause));
  }
}

export interface Repository<
  T extends Record<string, unknown>,
  Id extends SQLQueryBindings = string,
  Insert = T,
> {
  get(id: Id): Result<T | null, DbError>;
  all(): Result<T[], DbError>;
  insert(input: Insert): Result<T, DbError>;
  update(id: Id, patch: Partial<T>): Result<T | null, DbError>;
  delete(id: Id): Result<boolean, DbError>;
}

export function createRepository<S extends z.ZodObject, Id extends SQLQueryBindings = string>(
  db: Database,
  options: { table: string; schema: S; idColumn?: string },
): Repository<z.output<S> & Record<string, unknown>, Id, z.input<S>> {
  const { table, schema, idColumn = "id" } = options;
  assertIdentifier(table);
  assertIdentifier(idColumn);

  const columns = (value: Record<string, unknown>) => {
    const names = Object.keys(value);
    if (names.length === 0) throw new Error("Cannot write an empty record");
    names.forEach(assertIdentifier);
    return names;
  };

  return {
    get(id) {
      try {
        const row = db.query(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`).get(id) as unknown;
        if (row === null || row === undefined) return ok(null);
        const parsed = schema.safeParse(row);
        return parsed.success ? ok(parsed.data as z.output<S> & Record<string, unknown>) : err(parsed.error);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    all() {
      try {
        const rows = db.query(`SELECT * FROM "${table}"`).all();
        const parsed = z.array(schema).safeParse(rows);
        return parsed.success ? ok(parsed.data as (z.output<S> & Record<string, unknown>)[]) : err(parsed.error);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    insert(input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) return err(parsed.error);
      try {
        const row = parsed.data as Record<string, unknown>;
        const names = columns(row);
        const sql = `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
        db.query(sql).run(...names.map((name) => toSqlValue(row[name])));
        return ok(parsed.data as z.output<S> & Record<string, unknown>);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    update(id, patch) {
      const patchResult = z.record(z.string(), z.unknown()).safeParse(patch);
      if (!patchResult.success) return err(patchResult.error);
      try {
        const existing = db.query(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`).get(id) as unknown;
        if (existing === null || existing === undefined) return ok(null);
        const parsed = schema.safeParse({ ...(existing as Record<string, unknown>), ...patchResult.data });
        if (!parsed.success) return err(parsed.error);
        const row = parsed.data as Record<string, unknown>;
        const names = columns(row).filter((name) => name !== idColumn);
        if (names.length === 0) return ok(parsed.data as z.output<S> & Record<string, unknown>);
        db.query(`UPDATE "${table}" SET ${names.map((name) => `"${name}" = ?`).join(", ")} WHERE "${idColumn}" = ?`)
          .run(...names.map((name) => toSqlValue(row[name])), id);
        return ok(parsed.data as z.output<S> & Record<string, unknown>);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    delete(id) {
      try {
        const result = db.query(`DELETE FROM "${table}" WHERE "${idColumn}" = ?`).run(id);
        return ok(result.changes > 0);
      } catch (cause) {
        return err(asError(cause));
      }
    },
  };
}

export function withDatabase(db: Database): Middleware<BaseCtx, { db: Database }> {
  return () => ({ db });
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Invalid SQLite identifier: ${value}`);
}

function toSqlValue(value: unknown): SQLQueryBindings {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError("SQLite repository values must be scalar, byte arrays, or null");
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
