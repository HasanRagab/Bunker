import { Router } from "@2hasan2/bunker/http";
import { healthRoutes } from "@2hasan2/bunker/ops";
import { createRequestMetrics, metricsRoute } from "@2hasan2/bunker/ops";
import { createShutdown } from "@2hasan2/bunker/ops";

const shutdown = createShutdown({ timeoutMs: 10_000 });
const metrics = createRequestMetrics("api-1");
const router = Router.create();
healthRoutes(router, {
  checks: { database: () => true },
  isDraining: () => shutdown.isDraining,
});
metricsRoute(router, metrics);
shutdown.register(async () => {});
const fetch = shutdown.wrap(router.fetch);

void fetch;
