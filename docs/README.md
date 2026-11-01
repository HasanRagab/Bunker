# Documentation

Use the guides in order if this is your first time with the toolkit. Each guide
focuses on one task and points to a runnable example or reference page.

## Start here

1. [Getting started](./getting-started.md) — build and test your first typed
   endpoint.
2. [Database guide](./database.md) — define tables, generate migrations, and
   inject a typed database.
3. [Module map](./module-map.md) — choose a module without needing to know the
   whole toolkit.
4. [Build and publish](./publishing.md) — understand the ESM build, npm
   package contents, and manual release process.

## Add capabilities

- [Service communication](./services.md) — compose app modules or connect
  separate services in-process, over HTTP, or over TCP.
- [Production guide](./production.md) — Redis-backed state, workers, readiness,
  metrics, and graceful shutdown.
- [Detailed reference](./reference.md) — API samples and the complete feature
  overview.

## Examples

- [`example/app.ts`](../example/app.ts) — a small API with validation,
  middleware, domain logic, and logging.
- [`example/drizzle-db.ts`](../example/drizzle-db.ts) — typed database and
  migration usage.
- [`example/microservices.ts`](../example/microservices.ts) — app composition
  and service transports.
- [`example/scaling.ts`](../example/scaling.ts) — a Redis-backed web/worker
  deployment.

The examples are source files for the toolkit repository, not a complete
scaffold generator. Adapt them to your application and keep application schema,
secrets, and services in your own project.
