import type { Router, BaseCtx, RouteMap } from "./http/router";
import type { Awaitable } from "./types";

export type HealthCheck = () => Awaitable<void | boolean>;

export function healthRoutes<C extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  router: Router<C, Routes, Prefix>,
  options: { checks?: Record<string, HealthCheck>; healthPath?: string; readyPath?: string; isDraining?: () => boolean } = {},
): Router<C, Routes, Prefix> {
  const { checks = {}, healthPath = "/health", readyPath = "/ready", isDraining = () => false } = options;
  router.get(healthPath, { handler: () => ({ status: "ok" }) });
  router.get(readyPath, {
    handler: async () => {
      const results = await Promise.all([
        ["shutdown", !isDraining()] as const,
        ...Object.entries(checks).map(async ([name, check]) => {
        try {
          return [name, (await check()) !== false] as const;
        } catch {
          return [name, false] as const;
        }
      })]);
      const failed = results.filter(([, healthy]) => !healthy);
      return Response.json(
        { status: failed.length === 0 ? "ready" : "not_ready", checks: Object.fromEntries(results.map(([name, healthy]) => [name, { healthy }])) },
        { status: failed.length === 0 ? 200 : 503 },
      );
    },
  });
  return router;
}
