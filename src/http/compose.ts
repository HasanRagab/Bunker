import type { BaseCtx, RouteMap, Router } from "./router";

/**
 * Mount independently registered route groups under path prefixes.
 * @example
 * ```ts
 * const api = composeApps(Router.create(), [{ prefix: "/users", register: registerUsers }]);
 * ```
 */
export function composeApps<Ctx extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  router: Router<Ctx, Routes, Prefix>,
  apps: readonly {
    readonly prefix: string;
    readonly register: (router: Router<Ctx, Routes, `${Prefix}${string}`>) => unknown;
  }[],
): Router<Ctx, Routes, Prefix> {
  for (const app of apps) {
    if (!app.prefix.startsWith("/")) throw new TypeError(`App prefix must start with "/": ${app.prefix}`);
    app.register(router.group(app.prefix));
  }
  return router;
}
