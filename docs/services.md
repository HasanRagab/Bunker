# Service communication

Start with one backend process. Split into multiple backends only when
independent deployment, scaling, ownership, or failure isolation is useful.
Sharing a router or process is simpler and avoids network failure modes.

## Several route modules, one backend

When modules belong in one application, compose them into one router and mount
them under distinct prefixes:

```ts
const backend = composeApps(Router.create(), [
  { prefix: "/catalog", register: catalogModule },
  { prefix: "/billing", register: billingModule },
]);

serve(backend.fetch, { port: 3000 });
```

This is in-process route composition. It does not create separate services or
add a network hop. See [`example/microservices.ts`](../example/microservices.ts).

## In-process service calls

`MemoryServiceTransport` routes a request to a service registered in the same
process. It is useful for local composition and tests, but it does not share
state between worker processes or machines.

## Separate backends

For independently running services, run an HTTP or TCP server for each service.
A `ServiceRegistry` lets callers discover currently registered instances.
`RedisServiceRegistry` shares registrations across processes; the request still
travels directly to the chosen service endpoint.

```ts
const registry = new RedisServiceRegistry(redis);
const client = createServiceClient(registry, "catalog");
const response = await client.fetch(new Request("http://catalog/items/123"));
```

If caller and server share a router contract, `createDiscoveredClient()` adds
route, parameter, body, and response inference. Keep shared contracts in a
separate module used by both applications.

### Choosing a transport

| Transport | Use when | Notes |
|---|---|---|
| Memory | Same-process calls and tests | No cross-process sharing |
| HTTP | General service calls | Use a trusted network and normal TLS/auth at the edge |
| TCP | Controlled private networks | Toolkit uses a length-prefixed JSON protocol; it is not encrypted or authenticated |

Use a reachable DNS name or private IP as the registered endpoint. `0.0.0.0`
is a bind address, not a destination clients can connect to. The toolkit does
not automatically retry service calls; retry only operations that are safe to
repeat.

The Redis registry requires a Redis client implementing the toolkit's
structural interface. The toolkit does not bundle or select a Redis package.
See the [service example](../example/microservices.ts) and the detailed
[service reference](./reference.md#separate-backends-with-redis-discovery-and-tcp).

## Keep service boundaries explicit

- Validate public requests and responses with Zod schemas.
- Share contracts, not database connections or process-local maps.
- Give each service ownership of its own data and migration lifecycle.
- Treat timeouts and failed calls as normal outcomes.
- Do not expose raw TCP on an untrusted network without adding TLS and
  authentication outside this toolkit.
