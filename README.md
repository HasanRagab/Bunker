# kit — typed Bun backend toolkit

A collection of composable TypeScript modules for Bun, built around Zod,
fetch-compatible HTTP handlers, and typed data access. This project is a
toolkit—not a project generator. Start with only the modules your application
needs.

## Documentation

| If you want to… | Read |
|---|---|
| Build and test a typed API | [Getting started](./docs/getting-started.md) |
| Add SQLite, Drizzle, and migrations | [Database guide](./docs/database.md) |
| Organize modules or separate services | [Service communication](./docs/services.md) |
| Prepare Redis-backed multi-instance deployment | [Production guide](./docs/production.md) |
| Find the right module | [Module map](./docs/module-map.md) |
| Build and publish to npm | [Publishing guide](./docs/publishing.md) |
| Browse all features and expanded examples | [Detailed reference](./docs/reference.md) |

The [documentation home](./docs/README.md) lists guides and runnable examples.

## Quick look

After the initial npm release, install the package in a Bun application:

```sh
bun add @hasanragab/bunker
```

```ts
import { z } from "zod";
import { Router, serve } from "@hasanragab/bunker";

const api = Router.create().get("/hello/:name", {
  response: z.object({ message: z.string() }),
  handler: ({ params }) => ({ message: `Hello, ${params.name}!` }),
});

serve(api.fetch, { port: 3000 });
```

Routes can validate query strings and request bodies with Zod, infer handler
types, validate response values, and expose contracts to a typed client. Use
`createTestApp(api)` to test handlers without opening a network listener.

## Development

The package is built from `src/` into `dist/`; repository examples import from
source to exercise the working tree directly.

```sh
bun install
bun run check
bun test
```

Database scripts: `bun run db:generate` creates a migration from the configured
Drizzle schema; `bun run db:migrate` applies committed migrations.

The npm package build is `bun run build`. For manual versioning and publishing
steps, see the
[publishing guide](./docs/publishing.md).

## Guiding conventions

- Define runtime validation with Zod and infer types from those schemas.
- Inject shared resources through middleware or factory arguments, not mutable
  application globals.
- Keep domain/data failures explicit with `Result`; translate expected HTTP
  failures to `HttpError` at the route boundary.
- Use memory adapters for local development/tests only when process-local state
  is acceptable. Inject shared adapters when replicas must coordinate.
- Add features incrementally; not every app needs jobs, Redis, or microservices.
