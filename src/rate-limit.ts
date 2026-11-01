import { HttpError } from "./errors";
import type { Awaitable } from "./types";
import type { BaseCtx, Middleware } from "./http/router";

export interface RateLimitStoreLike {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export type RateLimitStore = RateLimitStoreLike;

export class MemoryRateLimitStore implements RateLimitStore {
  #windows = new Map<string, { count: number; resetAt: number }>();
  #operations = 0;

  async increment(key: string, windowMs: number, now: number) {
    if (++this.#operations % 100 === 0) {
      for (const [storedKey, value] of this.#windows) {
        if (value.resetAt <= now) this.#windows.delete(storedKey);
      }
    }
    let window = this.#windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.#windows.set(key, window);
    }
    window.count++;
    return { ...window };
  }
}

export function rateLimit<Ctx extends BaseCtx = BaseCtx>(options: {
  limit: number;
  windowMs: number;
  store: RateLimitStoreLike;
  key: (ctx: Ctx) => Awaitable<string>;
}): Middleware<Ctx, {}> {
  const { limit, windowMs, store, key } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Rate limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new RangeError("Rate limit window must be positive");
  return async (ctx) => {
    const state = await store.increment(await key(ctx), windowMs, Date.now());
    if (state.count > limit) {
      throw new HttpError(429, "Too Many Requests", { retryAfterMs: Math.max(0, state.resetAt - Date.now()) });
    }
    return {};
  };
}

/** Use only when the forwarding header is set by a trusted reverse proxy. */
export function trustedProxyIpKey(ctx: BaseCtx): string {
  const address = ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? ctx.req.headers.get("x-real-ip");
  if (!address) throw new Error("Client IP is unavailable; provide a trusted rate-limit key resolver");
  return address;
}
