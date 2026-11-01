import { HttpError } from "../core/errors";
import type { Awaitable } from "../core/types";
import type { RateLimitStoreLike } from "../infra/rate-limit";
import type { BaseCtx, Middleware } from "./router";

/**
 * Limit requests using a pluggable store and an explicit caller identity key.
 * @example
 * ```ts
 * const limit = rateLimit({ limit: 60, windowMs: 60_000, store, key: ({ user }) => user.id });
 * ```
 */
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

/**
 * Resolve a client IP when a trusted proxy sets the forwarding header.
 * @example
 * ```ts
 * const key = trustedProxyIpKey(context);
 * ```
 */
export function trustedProxyIpKey(ctx: BaseCtx): string {
  const address = ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? ctx.req.headers.get("x-real-ip");
  if (!address) throw new Error("Client IP is unavailable; provide a trusted rate-limit key resolver");
  return address;
}
