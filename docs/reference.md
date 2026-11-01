# Detailed toolkit reference

A small TypeScript backend toolkit built around Bun, Zod, and fetch-compatible
handlers. Zod schemas define runtime validation and the corresponding TypeScript
types. Domain code can stay framework-free and return `Result`; route handlers
are the HTTP boundary.

## Choose a guide

The documentation is organized by task so you can adopt only the parts you
need:

- [Documentation home](./README.md)
- [Getting started: routes, middleware, and tests](./getting-started.md)
- [Database: Drizzle, SQLite, and migrations](./database.md)
- [Service communication and microservices](./services.md)
- [Production: Redis, jobs, readiness, and shutdown](./production.md)
- [Module map](./module-map.md)

Runnable examples: [basic API](../example/app.ts), [database](../example/drizzle-db.ts),
[microservices](../example/microservices.ts), and [scaling](../example/scaling.ts).

## Run and verify

```sh
bun run dev
bun run check
bun test
```

## Feature overview

| Module | Exports / purpose |
|---|---|
| `http/router` | Typed routes, path params, Zod query/body/response validation, middleware context, OpenAPI generation |
| `http/client` | Inferred client inputs and response types from a registered router; returns `Result` |
| `http/testing` | `createTestApp(router)` for handler tests without opening a listener |
| `http/openapi` | OpenAPI JSON and a self-contained docs page |
| `http/middleware` | `bearerAuth`, `withCors` |
| `http/websocket` | Bun WebSocket upgrade handler with Zod-validated inbound messages |
| `db` | `bun:sqlite` opener, typed Zod-backed repositories, and database middleware |
| `cache` | `CacheStore`, memory store, and typed `cache.wrap()` returning `Result` |
| `rate-limit` | Store-backed middleware, memory store, and explicit key resolvers |
| `redis` | Redis cache/counter, rate-limit, atomic queue/visibility, and typed pub/sub drivers |
| `lock` | Redis TTL lock with token-checked compare-and-delete release |
| `idempotency` | Shared-cache Idempotency-Key replay wrapper |
| `jobs` | Typed job definitions and pluggable queue store with visibility leases |
| `scheduler` | Five-field UTC cron scheduling guarded by distributed locks |
| `health` | `/health` and `/ready` routes with pluggable readiness checks |
| `shutdown` | Request draining and reverse-order cleanup on SIGINT/SIGTERM |
| `jwt`, `password`, `security` | HS256 Web Crypto JWT, `Bun.password`, role middleware, security headers |
| `pagination` | Zod query/response schemas and cursor-based array pagination |
| `env`, `config` | Validated environment and layered defaults/env/overrides |
| `di` | Minimal typed service container |
| `uploads` | Bounded multipart parsing with file count and MIME allowlists |
| `http-client` | Zod-validated fetch client with timeouts, safe-method retries, and `Result` |
| `services` | Prefix composition, memory transport, HTTP/TCP service clients, and Redis service registry |
| `role` | `ROLE=web|worker|all` parsing and role-specific startup/cleanup |
| `metrics` | Per-instance HTTP request counters and Prometheus text output |
| `result`, `errors`, `logger`, `events`, `types` | Shared primitives |

## Routes, test helper, and typed client

Route registration returns a router whose type includes that route. Assign or
chain those return values to preserve the inferred client contract; mutating an
existing router still works at runtime but cannot update the type of an earlier
variable.

```ts
import { z } from "zod";
import { Router, createClient, createTestApp } from "../src";

const user = z.object({ id: z.string(), name: z.string() });
const api = Router.create().group("/api").get("/users/:id", {
  query: z.object({ verbose: z.coerce.boolean().default(false) }),
  response: user,
  handler: ({ params }) => ({ id: params.id, name: "Ada" }),
});

const client = createClient("http://localhost:3000", api);
const result = await client.request("GET", "/api/users/:id", {
  params: { id: "u1" },
  query: { verbose: true },
});
if (result.ok) console.log(result.value.name); // response inferred from `user`

const testApp = createTestApp(api);
const response = await testApp.req.get("/api/users/u1?verbose=true");
```

The client uses the same router instance to validate returned JSON against its
registered response schema. A non-2xx response, transport failure, or invalid
response is an `Err`; it does not fabricate a success value.

Generate and serve OpenAPI JSON/docs without restating schemas:

```ts
import { openAPIDocs } from "../src";

const docs = openAPIDocs(api, { title: "Users API", version: "1.0.0" });
const fetch = (req: Request) =>
  new URL(req.url).pathname.startsWith("/docs") || new URL(req.url).pathname === "/openapi.json"
    ? docs(req)
    : api.fetch(req);
```

`api.openAPI()` returns the OpenAPI 3.1 document directly. Unsupported Zod-to-JSON-Schema conversions fail explicitly.

## SQLite repositories and typed ORM

The lightweight `createRepository()` remains available for synchronous,
Zod-backed CRUD with `bun:sqlite`:

```ts
const opened = openDatabase("./data.sqlite");
if (!opened.ok) throw opened.error;
const db = opened.value;
db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL)");

const users = createRepository(db, {
  table: "users",
  schema: z.object({ id: z.string(), name: z.string() }),
});
const inserted = users.insert({ id: crypto.randomUUID(), name: "Ada" });

const router = Router.create().use(withDatabase(db));
// A handler on this router gets `ctx.db`; register db.close with createShutdown.
```

Repository table and column identifiers are validated; values are bound
parameters.

For schema-first ORM usage, define tables once in
[`src/db/schema.ts`](../src/db/schema.ts). Drizzle infers select/insert types,
and `drizzle-zod` derives runtime insert/update/select schemas from those same
table definitions. Use its normal typed query API:

```ts
import { Database } from "bun:sqlite";
import { createDrizzleDatabase, insertUserSchema, users } from "../src";

const client = new Database("./data/app.sqlite", { create: true, strict: true });
const db = createDrizzleDatabase(client);

const input = insertUserSchema.parse({ name: "Ada", email: "ada@example.com" });
const user = db.insert(users).values(input).returning().get();
const found = db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, user.id) });
client.close();
```

`createDrizzleDatabase()` defaults to the exported example schema; pass a
different schema with `{ schema }` for an application-specific database.
`withDrizzleDatabase(db)` injects that typed Drizzle instance into route
middleware. See [`example/drizzle-db.ts`](../example/drizzle-db.ts).

Generate and commit SQL migrations from the schema, then apply them either in a
deployment step or at application startup:

```sh
bun run db:generate
bun run db:migrate
```

`drizzle.config.ts` configures Drizzle Kit. `db:migrate` uses
`migrateDatabase(db, migrationsFolder)`, which runs Drizzle's migration runner
and returns `Result<void, Error>`. The checked-in `drizzle/` directory contains
the initial generated migration. Set `DATABASE_URL` to select the SQLite file;
`DRIZZLE_MIGRATIONS_FOLDER` can override the default migration directory.
Always close the underlying `bun:sqlite` client during shutdown.

## Multi-instance deployments

For an end-to-end composition, see [`example/scaling.ts`](../example/scaling.ts).
It takes a Redis command client and a separate subscriber connection, then
starts a role-specific service with a shared rate limiter, idempotent report
endpoint, Redis-backed jobs, distributed scheduler, readiness checks, and
graceful shutdown.

For multiple applications and service-to-service calls, see
[`example/microservices.ts`](../example/microservices.ts). It demonstrates
prefix composition, direct in-process calls, Redis registry usage, and a raw
TCP service.

### Compose apps into one backend

When modules belong in one backend, mount each under a prefix and serve one
router:

```ts
const backend = composeApps(Router.create(), [
  { prefix: "/catalog", register: catalogModule },
  { prefix: "/billing", register: billingModule },
]);

serve(backend.fetch, { port: 3000 });
```

No network hop is added between these modules. `composeApps()` mounts into the
same router, so route modules should register distinct paths.

### In-process service calls

Use the memory transport only when the caller and service share one process:

```ts
const catalog = Router.create().get("/items/:id", {
  handler: ({ params }) => ({ id: params.id }),
});
const memory = new MemoryServiceTransport();
const unregister = memory.register("catalog", catalog.fetch);

const response = await createMemoryServiceFetcher(memory, "catalog")(
  "http://catalog/items/item-1",
);
const item = await response.json();
```

This is not shared across worker processes or machines. Use HTTP or TCP for
those deployments.

### Separate backends with Redis discovery and TCP

Start each service as its own process. It binds a TCP endpoint, registers that
endpoint with a shared Redis registry, and heartbeats until shutdown:

```ts
const registry = new RedisServiceRegistry(redis);
const tcp = await serveTcpService(catalog.fetch, { host: "0.0.0.0", port: 4100 });
const registration = await registry.register({
  name: "catalog",
  instanceId: crypto.randomUUID(),
  endpoint: `tcp://${tcp.host}:${tcp.port}`,
  transport: "tcp",
});

shutdown.register(() => registration.close());
shutdown.register(() => tcp.close());
```

A caller discovers a live instance and sends a request using the matching
transport:

```ts
const catalogClient = createServiceClient(registry, "catalog");
const response = await catalogClient.fetch(
  new Request("http://catalog/items/item-1"),
);
if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
const item = z.object({ id: z.string() }).parse(await response.json());
```

If callers share the service's router contract, `createDiscoveredClient()`
adds inferred paths, params, bodies, and response validation on top of registry
discovery:

```ts
const catalogContract = Router.create().get("/items/:id", {
  response: z.object({ id: z.string(), name: z.string() }),
  handler: ({ params }) => ({ id: params.id, name: "example" }),
});
const catalog = createDiscoveredClient(registry, "catalog", catalogContract);
const result = await catalog.request("GET", "/items/:id", { params: { id: "item-1" } });
if (!result.ok) throw result.error;
console.log(result.value.name);
```

Set `transport: "http"` and an `http://` or `https://` endpoint to use HTTP
instead. The service client uses round-robin selection among healthy registry
entries. HTTP and raw TCP calls are not automatically retried; add retries only
for idempotent operations. Redis is the discovery/control plane here; service
requests travel directly over HTTP or TCP, not through Redis. Raw TCP uses a
length-prefixed JSON request/response protocol and is **not encrypted or
authenticated by this toolkit**. Keep it on a trusted private network or add a
TLS/authenticated proxy before exposing it. When binding to `0.0.0.0`, register
the service's reachable DNS name or private IP as its endpoint; `0.0.0.0` is a
bind address, not a client destination.

The toolkit defines the Redis interface but does not choose a Redis package.
For example, after adding the `redis` package to your application:

```ts
import { createClient as createRedisConnection } from "redis";
import { startScalingExample } from "../example/scaling";

const publisher = createRedisConnection({ url: Bun.env.REDIS_URL });
await publisher.connect();
const subscriber = publisher.duplicate();
await subscriber.connect();

await startScalingExample(publisher, subscriber, {
  closeRedis: async () => {
    await Promise.all([subscriber.quit(), publisher.quit()]);
  },
});
```

Run a web-only instance with `ROLE=web`, a worker-only instance with
`ROLE=worker`, or both in one process with `ROLE=all`. Each web process also
runs the lock-guarded scheduler, so only one replica enqueues each scheduled
tick.

Memory stores are explicit development/test adapters. Cache, rate-limit, and
queue factories require a store; production processes should inject shared
drivers instead of using process-local state. `Emitter` is intentionally
in-process for local side effects only. Use `PubSub` when other instances must
observe events. Sessions and any other durable coordination must likewise live
outside the process.

`RedisClient` is a small structural interface compatible with the Redis
commands used by the drivers. A typical setup uses a Redis v4-style client with
`set`, `eval`, `publish`, and `subscribe`; pass a dedicated subscriber connection
to `createRedisPubSub`:

```ts
const cacheStore = new RedisCacheStore(redis);
const rates = new RedisRateLimitStore(redis);
const queueStore = new RedisQueueStore(redis);
const locks = new RedisLock(redis);
const cache = createCache(cacheStore);
const queue = createQueue(queueStore, { visibilityTimeoutMs: 30_000 });

const events = createRedisPubSub(redisPublisher, redisSubscriber, {
  "cache.invalidate": z.object({ key: z.string() }),
});
```

The Redis queue atomically claims due jobs and tracks a visibility lease. A
worker renews the lease while a handler is running; expired claims become
available again after a crash. Delivery is at least once, so handlers must be
idempotent. Include `requestId` when enqueueing to carry it with the job, and
use `JobContext.requestId` in worker logs/outbound requests.

Schedulers use a distributed lock per scheduled job and UTC minute. A successful
enqueue leaves that short-lived lock in place until its TTL expires, preventing
other instances from enqueuing the same schedule tick. Set `lockTtlMs` longer
than the scheduler tick interval. Job handlers still need idempotency because
queue delivery is at least once.

`withIdempotency(fetch, sharedCache)` wraps the HTTP handler and atomically
claims keys using `CacheStore.setIfAbsent`. It scopes keys by host and
authorization token by default; provide `scope(request)` to use a stable
account/tenant identifier. Only POST, PUT, and PATCH requests with an
`Idempotency-Key` are recorded. Keep the TTL aligned with the API's retry
window.

Run web and worker roles from the same application with `parseRole()` and
`startRole()`. Use web for HTTP serving, worker for queue polling, and all for
both. On SIGTERM, connect `createShutdown().isDraining` to
`healthRoutes({ isDraining })`, stop queue polling, drain requests, then close
the server and shared connections. The request wrapper rejects new requests
while draining; `/ready` reports 503 immediately.

Register worker polling cancellation with `shutdown.registerStop(worker.stop)`
so workers stop claiming new jobs before request draining begins. Register
database/Redis close callbacks with `shutdown.register()`; those run after the
drain and server stop.

`createRequestMetrics()` gives each process an `instanceId`, in-flight gauge,
request counters, and Prometheus text output; `metricsRoute(router, metrics)`
exposes the per-instance `/metrics` endpoint. Logs include an instance
identifier, router-generated request IDs are returned in `x-request-id`, and
`createHttpClient({ requestId })` forwards a correlation ID. For one-host
multi-process deployments, `serve(fetch, { reusePort: true })` enables Bun port
reuse where supported; otherwise run processes/containers behind a proxy.

Run schema migrations as a one-off deployment step or under `RedisLock`, and
use expand/contract migrations so adjacent application versions can overlap
during rolling deploys.

### Shared rate limit and cache

Pass one shared Redis adapter to each process. Choose a rate-limit key from a
trusted identity (for example, `user.id` supplied by authentication middleware)
or a client IP resolved by a trusted proxy:

```ts
const redisCache = new RedisCacheStore(redis);
const cache = createCache(redisCache);

const api = Router.create().use(rateLimit({
  limit: 60,
  windowMs: 60_000,
  store: new RedisRateLimitStore(redis),
  key: ({ user }) => user.id,
}));

const profile = await cache.wrap(`profile:${user.id}`, 30_000, () => loadProfile(user.id));
if (!profile.ok) throw profile.error;
```

`CacheStore` saves strings. `createCache()` JSON-encodes values and parses
cached values with the supplied Zod schema when using `cache.get(key, schema)`.
The shared store also exposes atomic `setIfAbsent`, `compareAndSet`,
`compareAndDelete`, and `increment` operations for locks, idempotency, and
counters.

Try the protected report endpoint in the scaling example with a valid JWT and
an idempotency key:

```sh
curl -X POST http://localhost:3000/reports \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: report-request-123" \
  -H "Content-Type: application/json" \
  -d '{"reportId":"monthly-summary"}'
```

Repeating the exact request with that same key replays the original `202`
response; changing the body while reusing the key returns `409`.

### Distributed locks and scheduled work

Use the same Redis lock adapter in every scheduler process. `add()` takes a
stable task definition/name; each matching UTC minute has one shared lock key:

```ts
const locks = new RedisLock(redis);
const queue = createQueue(new RedisQueueStore(redis));
const cleanupJob = defineJob("cleanup", z.object({}), async () => {
  await removeExpiredRecords();
});

const scheduler = createScheduler(queue, locks);
const added = scheduler.add("0 * * * *", cleanupJob, {});
if (!added.ok) throw added.error;
await scheduler.start();
shutdown.registerStop(() => scheduler.stop());
```

The scheduler enqueues work rather than running the handler. Keep the lock TTL
longer than the scheduler tick interval; a successful tick lock stays until its
TTL expires so other instances skip that tick. A failed enqueue releases its
lock so another tick can retry.

### Idempotent endpoint and request-correlated job

Wrap the router fetch handler once, after route registration. All replicas must
use the same cache and scope the key to the same authenticated identity:

```ts
api.post("/reports", {
  body: z.object({ reportId: z.string() }),
  handler: async ({ body, requestId }) => {
    const queued = await queue.enqueue(generateReport, body, { requestId });
    if (!queued.ok) throw queued.error;
    return Response.json({ jobId: queued.value }, { status: 202 });
  },
});

const fetch = withIdempotency(api.fetch, redisCache, {
  scope: (request) => authenticatedUserId(request),
});
```

The wrapper records the response for POST/PUT/PATCH requests carrying an
`Idempotency-Key`. It rejects reuse with a different method, path, query,
content type, or body. Jobs receive `requestId` and `attempt` in their
`JobContext`, so logs and outbound requests can retain the original
correlation ID.

### Pub/sub and WebSocket fan-out

Create separate Redis publisher and subscriber connections. Publish a
schema-validated event from any worker; each web instance receives it and
sends it to the sockets connected to that instance:

```ts
const events = createRedisPubSub(redisPublisher, redisSubscriber, {
  "report.completed": z.object({ reportId: z.string() }),
});
const fanout = createWebSocketFanout(events, "report.completed");
const detach = await fanout.attach();

const ws = websocketRoute(z.object({ type: z.literal("subscribe") }), {
  open: (socket) => fanout.add(socket),
  message: () => {},
  close: (socket) => fanout.remove(socket),
});

const server = Bun.serve({ fetch: ws.fetch, websocket: ws.websocket });
shutdown.register(() => detach());
shutdown.attachServer(server);
```

Call `events.publish("report.completed", payload)` from any instance to fan it
out. `fanout.broadcast(payload)` only reaches sockets on the local instance;
`fanout.publish(payload)` sends through pub/sub.

### Role selection and graceful shutdown

Run the same entry point with `ROLE=web`, `ROLE=worker`, or `ROLE=all`. The
complete role composition is in [`example/scaling.ts`](../example/scaling.ts);
the core pattern is:

```ts
const parsedRole = parseRole();
if (!parsedRole.ok) throw parsedRole.error;

const shutdown = createShutdown({ timeoutMs: 25_000 });
const closeRedis = async () => {
  await redis.close();
};
const stopRoles = await startRole(parsedRole.value, {
  web: () => {
    const server = serve(shutdown.wrap(fetch), { port: 3000, reusePort: true });
    shutdown.attachServer(server);
  },
  worker: () => {
    const worker = queue.start([generateReport]);
    return () => worker.stop();
  },
});

healthRoutes(api, { isDraining: () => shutdown.isDraining });
shutdown.registerStop(stopRoles);
shutdown.register(closeRedis);
shutdown.installSignals();
```

Register worker stop functions with `registerStop()` so they stop claiming jobs
before request draining begins. `healthRoutes({ isDraining })` makes readiness
fail immediately on SIGTERM. Set the platform termination grace period longer
than the configured drain timeout.

## Production and security

- Stores for cache, rate limits, and queues are interfaces. Memory drivers are
  process-local and intended only for development/tests; Redis drivers provide
  shared counters, atomic locking/claiming, and pub/sub.
- Rate limiting requires an explicit `key(ctx)` resolver. Resolve the real
  client address at a trusted proxy boundary; do not trust caller-controlled
  forwarding headers.
- `defineJob()` validates its payload before enqueueing and again before
  handling. `createScheduler()` accepts five-field cron expressions and
  enqueues jobs; it does not execute job handlers itself.
- `createShutdown()` wraps fetch handlers, drains in-flight requests, stops an
  attached Bun server, and runs registered cleanup functions in reverse
  registration order. Attach the server, register database/queue cleanup, then
  call `installSignals()`.
- `websocketRoute()` returns Bun's `fetch` and `websocket` handlers for
  `Bun.serve`; invalid JSON or messages close with code `1007`.
- `parseUploads()` reads the multipart request within `maxBytes`. MIME values
  come from client-supplied headers; validate file content separately when
  stronger file-type guarantees are required.
- `createHttpClient()` retries only GET, HEAD, and OPTIONS by default so
  non-idempotent operations are not repeated automatically.

Modules are exported from [`src/index.ts`](../src/index.ts). A module can still
be a function taking a router; share request-scoped services through middleware
rather than globals.
