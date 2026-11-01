# Getting started

This walkthrough creates a small, validated API with environment config,
bearer auth, a typed module, and a request-level test. The complete checked
example lives in [`snippets/getting-started.ts`](./snippets/getting-started.ts).

## 1. Create a Bun project

```sh
bun init
bun add @2hasan2/bunker zod
bun add -d typescript @types/bun
```

## 2. Validate configuration at startup

Use Zod as the source of truth for configuration types:

```ts
import { z } from "zod";
import { defineEnv } from "@2hasan2/bunker/core";

const env = defineEnv({
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});
```

`defineEnv()` and `defineConfig()` are boot-time validation helpers. They throw
one actionable error listing all invalid values. Expected runtime failures
should return `Result`; throw `HttpError` only at an HTTP boundary.

## 3. Define a module with validated routes

Route registration returns a new typed router. Return the chain from the
module's `routes` function so `createApp` and `createClient` retain its route
contract:

```ts
import { z } from "zod";
import { bearerAuth, defineModule } from "@2hasan2/bunker/http";
import { verifyJwt } from "@2hasan2/bunker/auth";

const userSchema = z.object({ id: z.string(), role: z.enum(["admin", "user"]) });
const authenticate = bearerAuth(async (token) => {
  const result = await verifyJwt(token, env.JWT_SECRET, userSchema);
  return result.ok ? result.value : null;
});

const users = defineModule({
  name: "users",
  prefix: "/api",
  routes: (router) => router
    .use(authenticate)
    .get("/me", {
      response: userSchema,
      handler: ({ user }) => user,
    }),
});
```

## 4. Start and test without a listener

`createTestApp()` uses memory drivers and calls the routes directly; it does
not bind a port:

```ts
import { createTestApp } from "@2hasan2/bunker";

const testApp = await createTestApp({ modules: [users], env });
const response = await testApp.req.get("/api/me");
// Missing credentials correctly produce 401.
console.log(response.status);
await testApp.stop();
```

For production, compose the same module with `createApp({ env, drivers,
modules })`, then call `start()` and `stop()` from your process entry point.
See the [HTTP guide](./http.md), [Auth guide](./auth.md), and
[production guide](./production.md).
