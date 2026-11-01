# Publishing

The package is built as ESM with declarations in `dist/`. Consumers should use
the public subpaths rather than deep imports:

| Import | Entry |
|---|---|
| `@2hasan2/bunker` | App composition and complete root API |
| `@2hasan2/bunker/core` | Config, results, errors, services, and logging |
| `@2hasan2/bunker/http` | Router, middleware, typed client, and HTTP helpers |
| `@2hasan2/bunker/auth` | JWT, password, and role helpers |
| `@2hasan2/bunker/data` | SQLite repository |
| `@2hasan2/bunker/data/drizzle` | Optional Drizzle adapter |
| `@2hasan2/bunker/infra` | Cache, jobs, drivers, and coordination |
| `@2hasan2/bunker/ops` | Health, metrics, and shutdown |
| `@2hasan2/bunker/net` | Outbound HTTP and service discovery |

`package.json` exposes only these entry points, so unsupported internal deep
imports are blocked. Drizzle dependencies are optional peers; `redis` is also
optional unless a Redis driver bundle is used.

## Verify the package

```sh
bun run verify
bun run docs
npm pack --dry-run
```

The `docs` script generates the TypeDoc API reference in `docs/api/`.
`bun run check` type-checks documentation examples in `docs/snippets/`.

## Changeset release flow

Add a Changeset with each user-facing code change:

```sh
bun run changeset
```

Choose patch for a compatible fix, minor for a backward-compatible feature,
and major for a breaking API change. For import-path migrations, name the old
and new paths in the Changeset, for example:

```text
old: @2hasan2/bunker/src/http/router
new: @2hasan2/bunker/http
```

Commit the Changeset with the implementation and merge it to `main`. The
Changesets GitHub Action opens or updates the release PR; merging that PR
bumps the package version and publishes it to npm. CI pins Bun and runs
typecheck, tests, build, and the package content check.

For the first npm publish, configure a granular `NPM_TOKEN` GitHub secret
with package publish access and two-factor bypass enabled. Never commit tokens
or other credentials.
