# Infrastructure guide

The checked cache and queue example is [`snippets/infra.ts`](./snippets/infra.ts).

## Drivers, cache, and locks

**What it does:** `memoryDrivers()` and `redisDrivers()` assemble cache, lock,
queue, rate-limit, idempotency, and pub/sub adapters. `createCache()` adds
typed JSON values, optional Zod validation, and stampede protection.

**When to use it:** Use memory drivers for local development and tests. Use
Redis-backed drivers wherever instances must share state. Use locks for
distributed coordination.

**Example:**

```ts
import { z } from "zod";
import { createCache, memoryDrivers } from "@2hasan2/bunker/infra";

const drivers = memoryDrivers();
const cache = createCache(drivers.cache);
const result = await cache.wrap("profile:u1", 30_000, () => ({ id: "u1" }), {
  schema: z.object({ id: z.string() }),
  stampede: true,
});
await drivers.close();
void result;
```

**Gotchas:** Memory stores are process-local and emit a warning when
`NODE_ENV=production`. Never use them for coordination across replicas.
`drivers.close()` should be registered with shutdown for shared clients.

## Pub/sub

**What it does:** Typed `PubSub` validates payloads against event schemas.
Memory and Redis drivers implement the same contract.

**When to use it:** Use pub/sub when events must reach another process. Use
the in-process `Emitter` for local side effects.

**Example:** The driver bundle creates a pub/sub instance from the event
schemas declared by modules; see [the application example](../example/app.ts).

**Gotchas:** Redis pub/sub uses a dedicated subscriber connection. Delivery is
not a durable queue; use jobs when work must survive disconnects.

## Jobs and scheduling

**What it does:** `defineJob()` couples a Zod payload schema with a handler.
`createQueue()` enqueues and executes typed jobs; `createScheduler()` enqueues
cron matches under a distributed lock.

**When to use it:** Move slow or retryable work out of request handlers and
schedule recurring tasks across multiple instances.

**Example:** The checked infrastructure snippet defines a job and enqueues it.

**Gotchas:** Delivery is at least once; handlers must be idempotent. Share the
queue store and lock between scheduler instances, and register worker shutdown.

## Rate limiting and idempotency

**What it does:** Infrastructure exposes pluggable counter and cache stores
for the HTTP `rateLimit()` middleware and `withIdempotency()` fetch wrapper.

**When to use it:** Protect high-cost routes and safely replay retried writes
across process restarts.

**Example:** See [the protected-route recipes](./recipes.md#rate-limit-per-user)
for a typed per-user key, and the idempotent POST recipe for response replay.

**Gotchas:** Choose stable user or tenant keys after authentication. Use a
shared store when callers can reach multiple replicas; set idempotency TTL to
the client's retry window.
