import { z } from "zod";
import { err, ok, type Result } from "../core/result";

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const pageSchema = <Item extends z.ZodType>(item: Item) => z.object({
  items: z.array(item),
  nextCursor: z.string().nullable(),
});

export function paginateArray<T>(
  values: readonly T[],
  options: { limit: number; cursor?: string },
): Result<{ items: T[]; nextCursor: string | null }, Error> {
  const { limit, cursor } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return err(new RangeError("limit must be an integer from 1 to 100"));
  let offset = 0;
  if (cursor) {
    try {
      const decoded = Number(new TextDecoder().decode(base64UrlDecode(cursor)));
      if (!Number.isSafeInteger(decoded) || decoded < 0) throw new Error("Invalid cursor");
      offset = decoded;
    } catch (cause) {
      return err(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
  const items = values.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const nextCursor = nextOffset < values.length ? base64UrlEncode(String(nextOffset)) : null;
  return ok({ items, nextCursor });
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (char) => char.charCodeAt(0));
}
