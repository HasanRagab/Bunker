# Build and publish

This repository is prepared to publish the public npm package
[`@2hasan2/bunker`](https://www.npmjs.com/package/@2hasan2/bunker). The
package targets Bun because APIs such as `bun:sqlite`, `Bun.serve`, and
`Bun.password` are part of its public runtime surface.

## What the build produces

```sh
bun run build
```

TypeScript compiles `src/` into `dist/` as ESM JavaScript with declaration and
source-map files. `tsc-esm-fix` adds `.js` extensions to emitted relative ESM
imports. The package `exports` map points consumers to `dist/index.js` and
`dist/index.d.ts`.

Inspect the tarball before publishing:

```sh
npm pack --dry-run
```

The package allowlist in `package.json` includes the build, license, README,
guides, examples, source, and migration examples. CI runs typecheck, tests,
build, and this package-content check for each pull request to `main` or
`master`.

## First publish setup

The package already has a published release, so configure npm Trusted
Publishing once to let GitHub Actions publish without a long-lived npm token:

1. Open the [`@2hasan2/bunker` package settings](https://www.npmjs.com/package/@2hasan2/bunker/access).
2. Under **Trusted Publisher**, add **GitHub Actions** with:
   - Organization or user: `HasanRagab`
   - Repository: `Bunker`
   - Workflow filename: `release.yml`
   - Environment: leave blank
   - Allow direct `npm publish`
3. Ensure GitHub Actions is allowed to create pull requests in the repository
   settings.

The workflow requests the GitHub OIDC token with `id-token: write` and uses
Node.js 22.14+ and npm 11.5.1+. No `NPM_TOKEN` Actions secret is needed. Do not
add an OTP or npm access token to the workflow.

The first Trusted Publisher configuration must complete a successful publish
within npm's validation window. After saving the npm publisher settings, rerun
the failed Release workflow or push a new commit to `main`.

## Release flow

1. Make and verify a change. The release workflow runs typecheck, tests, and
   the package build for each push to `main`.
2. Add a Changeset describing the user-visible change:

   ```sh
   bun run changeset
   ```

3. Commit the changeset with the code and merge it to `main`.
4. GitHub Actions opens or updates a release pull request with version and
changelog changes.
5. Review and merge the release pull request. On the resulting `main` push,
the workflow publishes through npm Trusted Publishing.

For the first release under this npm scope, the included patch Changeset bumps
the current `0.1.1` metadata to `0.1.2`. For future changes, Changesets
prompts for patch, minor, or major. Use patch for a compatible fix, minor for a
backward-compatible feature, and major for a breaking public API change.

To inspect the package locally before merging:

```sh
bun run verify
npm pack --dry-run
```
