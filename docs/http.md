# HTTP guide

The checked examples are in [`snippets/http.ts`](./snippets/http.ts).

## Router, modules, and middleware

**What it does:** `Router` validates route params, query, bodies, and responses
with Zod. `defineModule()` packages a route chain and lifecycle hooks; `composeApps()`
mounts independent route groups. Middleware adds typed request context.

**When to use it:** Use these APIs for incoming HTTP behavior. Return the
router chain from modules so route types remain available to clients.

**Example:**

```ts
import { z } from "zod";
import { Router } from "@2hasan2/bunker/http";

const api = Router.create().get("/users/:id", {
  response: z.object({ id: z.string() }),
  handler: ({ params }) => ({ id: params.id }),
});
```

**Gotchas:** Runtime registration mutates the router, but only the returned
chain carries newly inferred route types. Use `HttpError` for expected HTTP
failures; other failures use the router error boundary.

## Typed clients, tests, and OpenAPI

**What it does:** `createClient()` infers params, query, bodies, and responses
from a router; `createTestApp(router)` calls handlers without a server;
`openAPI()` and `openAPIDocs()` derive API docs from route schemas.

**When to use it:** Share the router contract with frontend code, test route
behavior in `bun:test`, and publish OpenAPI without duplicating schemas.

**Example:**

```ts
import { createClient, createTestApp, Router } from "@2hasan2/bunker/http";
import { z } from "zod";

const api = Router.create().get("/users/:id", {
  response: z.object({ id: z.string() }),
  handler: ({ params }) => ({ id: params.id }),
});
const client = createClient("http://localhost:3000", api);
const result = await client.request("GET", "/users/:id", { params: { id: "u1" } });
const testApp = createTestApp(api);
const response = await testApp.req.get("/users/u1");
```

**Gotchas:** The typed client needs the router value returned from route
registration. HTTP and schema failures are returned as `Result` errors.

## Security, CORS, and rate-limit middleware

**What it does:** `withSecurityHeaders()` and `withCors()` wrap fetch
handlers. `bearerAuth()` verifies a token and adds a typed `user` to context.
The HTTP `rateLimit()` adapter consumes an infrastructure store.

**When to use it:** Add cross-cutting response headers and authentication at
the route boundary; configure CORS and rate-limit identity for your deployment.

**Example:**

```ts
import { Router, bearerAuth, rateLimit, type BaseCtx } from "@2hasan2/bunker/http";
import { memoryRateLimit } from "@2hasan2/bunker/infra";

const authenticate = bearerAuth(async (token) =>
  token === "test-token" ? { id: "user-1" } : null,
);
const protectedApi = Router.create()
  .use(authenticate)
  .get("/me", { handler: ({ user }) => user });
const limitedApi = Router.create().use(authenticate).use(rateLimit<BaseCtx & { user: { id: string } }>({
  limit: 60,
  windowMs: 60_000,
  store: memoryRateLimit(),
  key: ({ user }) => user.id,
}));
void [protectedApi, limitedApi];
```

**Gotchas:** Do not trust forwarded IP headers unless a trusted proxy boundary
sets them. Rate limiting is only shared across replicas when the injected store
is shared.

## Pagination, uploads, and WebSockets

**What it does:** `paginationQuery`, `pageSchema()`, and `paginateArray()`
provide bounded cursor pagination. `parseUploads()` limits multipart size,
file count, and MIME types. `websocketRoute()` validates incoming messages.

**When to use it:** Use pagination for bounded list endpoints, uploads for
untrusted multipart bodies, and WebSockets for long-lived real-time clients.

**Example:**

```ts
import { paginateArray, parseUploads } from "@2hasan2/bunker/http";

const page = paginateArray([{ id: "u1" }], { limit: 20 });
const uploaded = await parseUploads(new Request("http://localhost/upload"), {
  maxBytes: 5_000_000,
  maxFiles: 3,
});
void [page, uploaded];
```

**Gotchas:** Pagination cursors are opaque but not authorization tokens.
WebSocket routes use Bun's native server support; enforce authentication and
origin policy in the upgrade handler.

For running a server and composing the full app lifecycle, see
[getting started](./getting-started.md) and [production](./production.md).
