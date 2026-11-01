# Production guide

The central scaling rule is that process-local memory is not shared across
replicas. Memory adapters are useful for development and tests; use shared
stores when state must be consistent across processes.

## Identify state before scaling

| Concern | Local option | Shared/production approach |
|---|---|---|
| Cache | Memory store | Redis cache store |
| Rate limits | Memory store | Redis rate-limit store |
| Queue | Memory queue | Redis queue with visibility leases |
| Locks | None/process-local | Redis TTL lock |
| Cross-instance events | `Emitter` | Redis pub/sub |
| Service discovery | Memory registry | Redis service registry |
| Database | SQLite file | SQLite is local-file storage; use a database architecture suited to shared access before scaling it across hosts |

Do not use a process-local memory store for rate limits, job coordination, or
cache invalidation when replicas must agree.

## Redis setup and roles

Inject a Redis client into the toolkit's adapters. The toolkit defines the
structural `RedisClient` interface but does not choose a Redis library.
Redis pub/sub requires a publisher and a separate subscriber connection.
Example setup is in [`example/scaling.ts`](../example/scaling.ts).

Run the same codebase with:

- `ROLE=web` for HTTP serving
- `ROLE=worker` for job processing
- `ROLE=all` for both roles in one process

`RedisQueueStore` claims jobs atomically and uses a visibility lease. Delivery
is at least once: jobs may run again after a crash or lease expiry, so handlers
must be idempotent. Include `requestId` when enqueueing to carry request
correlation into the job context.

Schedulers enqueue jobs; they do not execute job handlers themselves. With a
shared `RedisLock`, schedulers use lock-guarded ticks so replicas do not enqueue
the same scheduled task in normal operation. Queue handlers still need
idempotency.

## Readiness and graceful shutdown

Wrap the fetch handler with `createShutdown().wrap()`, expose
`healthRoutes({ isDraining })`, and attach the server. On SIGTERM, readiness
immediately reports unavailable, new requests are rejected, and in-flight
requests drain before cleanup.

Stop workers from claiming new jobs before draining and closing resources.
Register cleanup functions for the database and Redis connections, then install
signal handlers. Set the platform termination grace period longer than the
configured drain timeout.

## Request safety and observability

- `rateLimit()` requires an explicit identity key. Resolve client IP only at a
  trusted proxy boundary; do not trust arbitrary forwarded headers.
- `withIdempotency()` stores completed POST/PUT/PATCH responses in shared cache.
  Scope keys to a stable authenticated user or tenant, and set a TTL matching
  the caller retry window.
- Use Redis pub/sub for events that other instances must receive. `Emitter` is
  for same-process side effects.
- `createRequestMetrics()` reports per-instance HTTP metrics. Carry
  `requestId` into jobs and outbound calls.
- `withSecurityHeaders()` provides baseline response headers; configure
  CORS/authentication for your actual deployment separately.

## Migrations and deployment

Run database migrations as a one-off release step before routing traffic to the
new version, or protect startup migration with a shared distributed lock.
Prefer backward-compatible expand/contract changes during rolling deploys.
See the [database guide](./database.md).

For the full composition, including Redis queueing, pub/sub, rate limiting,
idempotency, and role startup, see [`example/scaling.ts`](../example/scaling.ts)
and the [detailed production reference](./reference.md#multi-instance-deployments).
