# Operations guide

The checked setup is [`snippets/ops.ts`](./snippets/ops.ts).

## Health and readiness

**What it does:** `healthRoutes()` adds `/health` and `/ready`. Readiness can
run named checks and return unavailable while the application drains.

**When to use it:** Point platform liveness probes at `/health` and readiness
probes at `/ready`.

**Example:** The checked operations snippet registers a database readiness
check and uses the shutdown state to gate readiness.

**Gotchas:** Keep liveness independent of downstream dependencies to avoid
unnecessary restart loops. Readiness checks should be bounded and fast.

## Metrics

**What it does:** `createRequestMetrics()` records per-instance counts,
in-flight requests, and durations. `metricsRoute()` exposes Prometheus text.

**When to use it:** Use these metrics for basic per-instance HTTP
observability; send the output to your existing metrics scraper.

**Example:** The checked snippet adds `/metrics` to the same router.

**Gotchas:** Metrics are process-local. Scrape each instance or aggregate
externally; do not treat in-memory counters as durable totals.

## Graceful shutdown

**What it does:** `createShutdown()` rejects new requests, stops registered
workers, drains in-flight requests, stops the server, and runs cleanup in
reverse registration order.

**When to use it:** Install signal handlers in a production process and
register server, queue, and database/Redis cleanup.

**Example:**

```ts
import { Database } from "bun:sqlite";
import { Router } from "@2hasan2/bunker/http";
import { createShutdown } from "@2hasan2/bunker/ops";

const database = new Database(":memory:", { create: true });
const router = Router.create();
const shutdown = createShutdown({ timeoutMs: 20_000 });
shutdown.register(() => database.close());
const fetch = shutdown.wrap(router.fetch);
void fetch;
```

**Gotchas:** Set the deployment termination grace period longer than the drain
timeout. Unregister installed signals in tests or short-lived processes.
