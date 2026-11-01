# Recipes

These are short patterns built from the same public APIs as the checked
examples in [`snippets/recipes.ts`](./snippets/recipes.ts).

## Protected route with roles

Authenticate first, then use `requireRole()` to narrow `user.role`:

```ts
import { requireRole } from "@2hasan2/bunker/auth";
import { bearerAuth, Router } from "@2hasan2/bunker/http";

const authenticate = bearerAuth(async () => ({ id: "u1", role: "admin" }));
const adminApi = Router.create()
  .use(bearerAuth(async () => ({ id: "u1", role: "admin" })))
  .use(requireRole<"admin", { id: string; role: string }>("admin"))
  .get("/admin", { handler: ({ user }) => ({ id: user.id, role: user.role }) });
void [authenticate, adminApi];
```

## Rate limit per user

Place rate-limit middleware after authentication and inject the bundle's store:

```ts
import { memoryDrivers } from "@2hasan2/bunker/infra";
import { bearerAuth, rateLimit, Router, type BaseCtx } from "@2hasan2/bunker/http";

const user = { id: "u1" };
const authenticate = bearerAuth(async () => user);
const drivers = memoryDrivers();
const api = Router.create()
  .use(authenticate)
  .use(rateLimit<BaseCtx & { user: typeof user }>({
    limit: 60,
    windowMs: 60_000,
    store: drivers.rateLimit,
    key: (context) => context.user.id,
  }));
void api;
await drivers.close();
```

## Run a cron job once across instances

Use the shared queue and lock from the same Redis driver bundle:

```ts
import { createQueue, defineJob, memoryDrivers } from "@2hasan2/bunker/infra";
import { createScheduler } from "@2hasan2/bunker/infra";
import { createShutdown } from "@2hasan2/bunker/ops";
import { z } from "zod";

const drivers = memoryDrivers();
const cleanupJob = defineJob("cleanup", z.object({}), async () => {});
const shutdown = createShutdown();
const queue = createQueue(drivers.queue);
const scheduler = createScheduler(queue, drivers.lock);
const added = scheduler.add("0 * * * *", cleanupJob, {});
if (!added.ok) throw added.error;
await scheduler.start();
shutdown.registerStop(() => scheduler.stop());
await scheduler.stop();
await drivers.close();
```

## Idempotent POST

Wrap the route fetcher with a shared cache store. The wrapper replays the
original response for a repeated key/body pair:

```ts
import { Router } from "@2hasan2/bunker/http";
import { memoryDrivers, withIdempotency } from "@2hasan2/bunker/infra";

const drivers = memoryDrivers();
const api = Router.create().get("/resource", { handler: () => ({ ok: true }) });
const idempotentFetch = withIdempotency(api.fetch, drivers.idempotency);
void idempotentFetch;
await drivers.close();
```

## Typed API client from a router

Keep the route chain's returned value and pass it to `createClient()`:

```ts
import { createClient, Router } from "@2hasan2/bunker/http";
import { z } from "zod";

const contract = Router.create().get("/users/:id", {
  response: z.object({ id: z.string() }),
  handler: ({ params }) => ({ id: params.id }),
});
const client = createClient("https://api.example.test", contract);
const result = await client.request("GET", "/users/:id", { params: { id: "u1" } });
void result;
```

## Graceful shutdown

Wrap the fetch handler and register resource cleanup in creation order:

```ts
import { Database } from "bun:sqlite";
import { Router } from "@2hasan2/bunker/http";
import { createShutdown } from "@2hasan2/bunker/ops";

const database = new Database(":memory:", { create: true });
const api = Router.create();
const shutdown = createShutdown({ timeoutMs: 20_000 });
shutdown.register(() => database.close());
const fetch = shutdown.wrap(api.fetch);
const removeSignals = shutdown.installSignals();
removeSignals();
void fetch;
```

Adapt `database`, `drivers`, `cleanupJob`, and `authenticate` to the
application. Each complete checked example is in the linked snippet file.
