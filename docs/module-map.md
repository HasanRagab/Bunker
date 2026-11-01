# Module map

The public barrel [`src/index.ts`](../src/index.ts) exports all modules for
convenience. For discoverability, source files are grouped by their main
responsibility; modules generally depend on shared types and interfaces rather
than importing application-specific code from each other.

## Build an API

| Need | Start with |
|---|---|
| Routes and middleware | [`http/router.ts`](../src/http/router.ts) |
| Run a Bun server | [`http/server.ts`](../src/http/server.ts) |
| Test handlers directly | [`http/testing.ts`](../src/http/testing.ts) |
| Typed client from a router | [`http/client.ts`](../src/http/client.ts) |
| OpenAPI spec and docs UI | [`http/openapi.ts`](../src/http/openapi.ts) |
| CORS, bearer auth | [`http/middleware.ts`](../src/http/middleware.ts) |
| WebSockets | [`http/websocket.ts`](../src/http/websocket.ts) |
| Outbound HTTP | [`http-client.ts`](../src/http-client.ts) |

## Application data and config

| Need | Start with |
|---|---|
| Drizzle ORM, schemas, migrations | [`db/`](../src/db/) |
| Small raw-SQL repositories | [`db/index.ts`](../src/db/index.ts) |
| Environment validation | [`env.ts`](../src/env.ts) |
| Layered config | [`config.ts`](../src/config.ts) |
| Typed dependency container | [`di.ts`](../src/di.ts) |
| Result values and HTTP errors | [`result.ts`](../src/result.ts), [`errors.ts`](../src/errors.ts) |

## Production and coordination

| Need | Start with |
|---|---|
| Cache and storage adapters | [`cache.ts`](../src/cache.ts), [`redis.ts`](../src/redis.ts) |
| Rate limiting | [`rate-limit.ts`](../src/rate-limit.ts) |
| Distributed locks | [`lock.ts`](../src/lock.ts) |
| Jobs and scheduler | [`jobs.ts`](../src/jobs.ts), [`scheduler.ts`](../src/scheduler.ts) |
| Pub/sub | [`pubsub.ts`](../src/pubsub.ts) |
| Readiness and shutdown | [`health.ts`](../src/health.ts), [`shutdown.ts`](../src/shutdown.ts) |
| Roles and metrics | [`role.ts`](../src/role.ts), [`metrics.ts`](../src/metrics.ts) |
| Service composition/discovery | [`services.ts`](../src/services.ts) |

Other focused helpers include JWT, passwords, security headers, pagination,
uploads, logging, events, and request tracing. The
[detailed reference](./reference.md) provides the feature overview and selected
usage examples.

## Usage principles

1. Define runtime schemas with Zod and infer TypeScript types from them.
2. Inject shared resources through middleware or factory arguments; avoid
   application-wide mutable globals.
3. Return `Result` for expected failures in domain/data helpers. Convert errors
   to HTTP responses at the route boundary.
4. Choose memory adapters only when losing local state is acceptable.
5. Add modules as needed; a typical app does not need every exported feature.
