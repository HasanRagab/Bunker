# Production guide

Bunker does not make process-local state distributed. Treat each server as
ephemeral and make every cross-instance dependency explicit.

## Multi-instance rules

- **No in-process coordination:** memory cache, locks, queues, rate-limit
  counters, and registries are local to one process. Do not rely on them when
  requests or jobs can move between replicas.
- **Shared cache:** use Redis-backed cache when instances must observe the
  same values or invalidations.
- **Shared locks:** use a Redis lock for scheduler ticks, migrations, or any
  run-once task. A lock reduces duplicate enqueueing; job handlers still need
  to be idempotent.
- **Shared pub/sub:** use Redis pub/sub for notifications across processes.
  The in-process `Emitter` is for local side effects only.
- **Run-once schedulers:** all scheduler instances should use the same lock
  store and task name. Schedulers enqueue jobs; queue workers execute them.
- **Rolling deployments:** use backward-compatible expand/contract database
  migrations so adjacent versions can operate during rollout.

`memoryDrivers()` warns when `NODE_ENV=production`; that warning does not make
the memory drivers safe for multi-instance production.

## Roles and queues

Run web and worker roles from the same application with `ROLE=web`,
`ROLE=worker`, or `ROLE=all`. Queue delivery is at least once: a worker crash
or expired visibility lease can cause a job to run again. Make job handlers
idempotent and propagate `requestId` for logs and outbound calls.

See the Redis-backed [scaling example](../example/scaling.ts) and the
[infrastructure guide](./infra.md) for a complete driver setup.

## Readiness and graceful shutdown

Expose `/health` for liveness and `/ready` for dependency checks and drain
state. On SIGTERM, stop claiming new jobs, reject new requests, drain active
requests, stop the server, and close database/Redis clients. Register cleanup
with `createShutdown()` and set the platform termination grace period longer
than the drain timeout.

## Deploy checklist

- [ ] Validate all required environment values during startup with
  `defineEnv()` or `defineConfig()`.
- [ ] Use shared Redis drivers for state that must coordinate across replicas.
- [ ] Check that queue handlers are safe to retry and have bounded retry
  policies.
- [ ] Ensure only shared-lock schedulers can run recurring tasks.
- [ ] Apply migrations as a release step or under a shared lock; keep them
  compatible with the previous and next application versions.
- [ ] Configure trusted proxy boundaries before using IP-based rate limits.
- [ ] Verify readiness checks and request draining with the deployment
  platform's termination window.
- [ ] Scrape per-instance metrics and include `instanceId`/`requestId` in logs.
- [ ] Run `bun run verify` and inspect `npm pack --dry-run` before publishing.
