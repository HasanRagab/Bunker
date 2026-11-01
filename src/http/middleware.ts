import { HttpError } from "../core/errors";
import type { Awaitable } from "../core/types";
import type { BaseCtx, Middleware } from "./router";

/** Bearer auth. `verify` returns your user type or null; the type flows into ctx.user. */
/**
 * Validate bearer credentials and add the resulting user to route context.
 * @example
 * ```ts
 * const auth = bearerAuth(async (token) => verifyToken(token));
 * ```
 */
export function bearerAuth<U extends object>(
  verify: (token: string) => Awaitable<U | null>,
): Middleware<BaseCtx, { user: U }> {
  return async ({ req }) => {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw HttpError.unauthorized("Missing bearer token");
    const user = await verify(token);
    if (!user) throw HttpError.unauthorized("Invalid token");
    return { user };
  };
}

/** Wrap a fetch handler with permissive-by-config CORS. */
/**
 * Wrap a fetch handler with configurable CORS headers.
 * @example
 * ```ts
 * const fetch = withCors(router.fetch, { origin: "https://app.example.test" });
 * ```
 */
export function withCors(
  handler: (req: Request) => Promise<Response>,
  opts: { origin?: string; methods?: string; headers?: string } = {},
) {
  const { origin = "*", methods = "GET,POST,PUT,PATCH,DELETE,OPTIONS", headers = "content-type,authorization" } = opts;
  const apply = (res: Response) => {
    res.headers.set("access-control-allow-origin", origin);
    res.headers.set("access-control-allow-methods", methods);
    res.headers.set("access-control-allow-headers", headers);
    return res;
  };
  return async (req: Request) => (req.method === "OPTIONS" ? apply(new Response(null, { status: 204 })) : apply(await handler(req)));
}
