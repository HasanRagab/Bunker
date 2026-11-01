# Networking guide

The checked outbound-client example is [`snippets/net.ts`](./snippets/net.ts).

## Outbound HTTP client

**What it does:** `createHttpClient()` provides timeouts, safe-method retries,
request ID propagation, Zod response validation, and `Result` errors.

**When to use it:** Use it for service-to-service HTTP calls where callers
need typed responses and explicit transport/status failures.

**Example:** The checked snippet requests a JSON resource and narrows its
response through a Zod object schema.

**Gotchas:** Retries default to GET/HEAD/OPTIONS. Do not retry non-idempotent
operations unless the remote API supports idempotency keys.

## Service registry and transports

**What it does:** Memory and Redis registries track service instances with
heartbeats. Service clients select a healthy instance and call it over HTTP
or Bun's length-prefixed TCP transport.

**When to use it:** Use discovery for independently deployed services that
need dynamic instance selection; use a fixed URL for simpler deployments.

**Example:**

```ts
import { createServiceClient, memoryServiceRegistry } from "@2hasan2/bunker/net";

const registry = memoryServiceRegistry();
const registration = await registry.register({
  name: "catalog",
  instanceId: "catalog-1",
  endpoint: "http://127.0.0.1:3001",
  transport: "http",
});
const catalog = createServiceClient(registry, "catalog");
const instances = await catalog.discover();
await registration.close();
void instances;
```

**Gotchas:** The memory registry is process-local. Raw TCP is neither
encrypted nor authenticated by the toolkit; keep it on a trusted network or
place it behind a secured transport.
