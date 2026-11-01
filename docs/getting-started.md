# Getting started

This toolkit is a collection of composable TypeScript modules for Bun. It does
not require a generated project structure: define ordinary functions and
schemas, then compose them with a `Router`.

## Requirements

- Bun
- TypeScript
- Zod

In this repository, dependencies are already declared. Install them and run
the basic checks with:

```sh
bun install
bun run check
bun test
```

The examples import from `../src` because they live in this repository. This
repository does not currently define a compiled package export; when consuming
it from another project, configure a workspace or package entry point first.

## Define a route

```ts
import { z } from "zod";
import { HttpError, Router, serve } from "../src";

const User = z.object({
  id: z.string(),
  name: z.string().min(1),
});

const api = Router.create().post("/users", {
  body: z.object({ name: z.string().min(1) }),
  response: User,
  handler: ({ body }) => ({
    id: crypto.randomUUID(),
    name: body.name,
  }),
}).get("/users/:id", {
  response: User,
  handler: ({ params }) => {
    if (params.id === "missing") throw HttpError.notFound("User not found");
    return { id: params.id, name: "Ada" };
  },
});

serve(api.fetch, { port: 3000 });
```

Schemas have two jobs: they validate incoming requests at runtime and provide
the handler's TypeScript types. A `response` schema also validates handler
output. Omit it when the route returns a `Response` directly or does not need
JSON response validation.

Handlers receive `req`, `url`, `requestId`, and `log` in their context, plus
validated `params`, `query`, and `body`. Throw `HttpError` for expected HTTP
failures; otherwise thrown errors are handled by the router's error boundary.

## Compose middleware and route modules

Middleware adds typed fields to the handler context. A module can register its
routes on the router passed to it:

```ts
import { Router, type BaseCtx } from "../src";

const registerUsers = <C extends BaseCtx>(router: Router<C>) => {
  router.get("/users", {
    handler: ({ requestId }) => ({ requestId, items: [] }),
  });
};

const api = Router.create();
registerUsers(api.group("/api"));
```

Use the value returned from route registration when you need TypeScript to
preserve the complete route contract for a typed client:

```ts
const contract = Router.create().get("/users/:id", {
  response: User,
  handler: ({ params }) => ({ id: params.id, name: "Ada" }),
});
```

The router still registers routes at runtime when mutated without retaining the
returned value, but a client created from an earlier router variable cannot
infer routes added later.

## Test without opening a port

```ts
import { expect } from "bun:test";
import { createTestApp } from "../src";

const testApp = createTestApp(api);
const response = await testApp.req.post("/users", { name: "Ada" });

expect(response.status).toBe(200);
expect(await response.json()).toMatchObject({ name: "Ada" });
```

`createTestApp()` calls the router directly with synthetic `Request` objects.
Use Bun's `bun:test` for assertions and tests.

## Next steps

- Add a typed persistent data layer with the [database guide](./database.md).
- See [service communication](./services.md) before splitting an app into
  multiple backends.
- Use the [production guide](./production.md) when adding shared state,
  background workers, or graceful shutdown.
- See the full route/client/OpenAPI examples in the
  [detailed reference](./reference.md).
