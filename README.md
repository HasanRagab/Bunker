# @2hasan2/bunker

Bunker is a small, composable toolkit for building type-safe Bun backends with
TypeScript and Zod. Use only the pieces you need: typed routes, repositories,
auth, infrastructure drivers, and operational helpers, without adopting a
framework-wide runtime.

## Install

```sh
bun add @2hasan2/bunker zod
```

## A typed API in a few lines

```ts
import { z } from "zod";
import { Router, serve } from "@2hasan2/bunker/http";

const api = Router.create().get("/hello/:name", {
  response: z.object({ message: z.string() }),
  handler: ({ params }) => ({ message: `Hello, ${params.name}!` }),
});

serve(api.fetch, { port: 3000 });
```

This example is type-checked in [`docs/snippets/readme.ts`](./docs/snippets/readme.ts).

## Modules

| Module | Import path | Use when |
|---|---|---|
| Core | `@2hasan2/bunker/core` | Validating config, handling results, logging, and defining services |
| HTTP | `@2hasan2/bunker/http` | Building routes, middleware, typed clients, and HTTP tests |
| Auth | `@2hasan2/bunker/auth` | Signing tokens, hashing passwords, and enforcing roles |
| Data | `@2hasan2/bunker/data` | Using SQLite repositories; install optional Drizzle peers for `/data/drizzle` |
| Infra | `@2hasan2/bunker/infra` | Adding cache, locks, jobs, scheduling, rate limits, and pub/sub |
| Ops | `@2hasan2/bunker/ops` | Adding health checks, metrics, and graceful shutdown |
| Net | `@2hasan2/bunker/net` | Calling other services or discovering service instances |
| App | `@2hasan2/bunker` | Composing modules with `createApp` and `createTestApp` |

## Guides

- [Getting started](./docs/getting-started.md)
- [HTTP](./docs/http.md) · [Auth](./docs/auth.md) · [Data](./docs/data.md)
- [Infrastructure](./docs/infra.md) · [Operations](./docs/ops.md) · [Networking](./docs/net.md)
- [Recipes](./docs/recipes.md) · [Production](./docs/production.md)
- [Publishing](./docs/publishing.md) · [Generated API reference](./docs/api/index.html)

## Scaffold a project

```sh
bunx create-bunker my-api
cd my-api
bun install
bun run dev
```

Inside a project, create a starter module with `bunker generate module users`.
