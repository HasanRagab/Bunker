# @2hasan2/bunker

## 1.0.0

### Major Changes

- beb1ab8: Validate malformed encoded route parameters as HTTP 400 responses, add schema validation and optional stampede protection to `cache.wrap`, and remove the duplicate `CacheStore.del` API.
- 81d62ad: Move Drizzle APIs to `@2hasan2/bunker/data/drizzle`, make Drizzle integrations optional peers, and standardize built-in Redis key prefixes from `kit:` to `bunker:`. Existing keys written under `kit:` are not migrated automatically; set an explicit legacy prefix where continued access is needed.

### Minor Changes

- 3950ce6: Add a `wrapFetch` composition hook to `createApp` for cross-cutting adapters, and migrate the basic and scaling examples to typed modules and app composition.
- db437d8: Add memory and Redis driver bundles for cache, locks, pub/sub, jobs, rate limits, and idempotency; Redis URL support uses an optional `redis` peer dependency.
- ecd4d43: Add in-memory lock and pub/sub drivers, canonical driver factories, logger-backed job diagnostics, dead-letter callbacks, and optional exponential retry backoff.
- c18177a: Add a module-aware `createTestApp({ modules })` overload that starts modules with memory drivers and exposes synthetic request helpers without opening a network listener. Preserve the existing synchronous router overload.
- 6941ff9: Add the optional `createApp` composition layer for modules, drivers, HTTP routes, health checks, metrics, scheduling, roles, CORS, and graceful shutdown. Module route types remain available to typed API clients.
- b0ae1ea: Add the `create-bunker` starter project command and `bunker generate module <name>` generator.
- b7e5b18: Add typed module definitions with service dependencies, route contracts, job and event metadata, and dependency-ordered startup with reverse shutdown.
- 4647cbd: Add typed service tokens and a service registry; deprecate the string-keyed container in favor of `defineService` and `createServiceRegistry`.

### Patch Changes

- b13d58d: Improve boot-time configuration and setup errors with actionable messages, and report every environment and configuration schema issue together.
- 4ea2d21: Add task-oriented developer guides, type-checked examples, and a generated TypeDoc API reference.
- 7aa0bce: Document public toolkit APIs with TSDoc examples and include the optional Drizzle adapter in generated API docs.

## 0.1.2

### Patch Changes

- b5589cd: Prepare the first public release under the @2hasan2 npm scope.
