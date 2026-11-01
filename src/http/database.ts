import { Database } from "bun:sqlite";
import type { BaseCtx, Middleware } from "./router";

export function withDatabase(db: Database): Middleware<BaseCtx, { db: Database }> {
  return () => ({ db });
}
