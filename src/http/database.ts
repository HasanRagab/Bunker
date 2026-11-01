import { Database } from "bun:sqlite";
import type { BaseCtx, Middleware } from "./router";

/**
 * Inject a Bun SQLite database into route handler context.
 * @example
 * ```ts
 * const api = Router.create().use(withDatabase(db));
 * ```
 */
export function withDatabase(db: Database): Middleware<BaseCtx, { db: Database }> {
  return () => ({ db });
}
