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

The package allowlist includes the build, license, README, and guides. It does
not ship repository examples. Drizzle integrations are optional peer
dependencies and are exposed only through `@2hasan2/bunker/data/drizzle`;
consumers that do not use Drizzle do not need to install those peers. CI runs
typecheck, tests, build, and the package-content check for each pull request.

## First publish setup

The release workflow uses an npm granular access token, like the
[`api-geno`](https://github.com/HasanRagab/api-geno) release flow:

1. In npm, open **Account → Access Tokens → Generate New Token** and choose a
   granular token.
2. Enable **Bypass two-factor authentication**.
3. Give it **Read and write (publish and stage)** access for
   `@2hasan2/bunker` (or the `@2hasan2` scope), and set an appropriate
   expiration.
4. Copy the token and save it as the GitHub Actions repository secret
   `NPM_TOKEN` under **Settings → Secrets and variables → Actions**. The
   release workflow configures npm's registry authentication and passes this
   secret as `NODE_AUTH_TOKEN` when Changesets publishes.
5. Ensure GitHub Actions is allowed to create pull requests in the repository
   settings.

The bypass-2FA option is required for a CI token; otherwise npm returns
`EOTP`. Never put the token in source control or workflow YAML. If publishing
still returns `EOTP`, replace the secret with a newly generated granular token
that explicitly has **Bypass two-factor authentication** enabled and publish
access to this package. If a workflow reports `ENEEDAUTH`, verify the secret
exists and has publish access.

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
the workflow publishes the package using `NPM_TOKEN`.

The first release Changeset has already been merged and the package metadata
is now `0.1.2`; after updating `NPM_TOKEN`, rerun the latest failed Release
workflow. For future changes, Changesets prompts for patch, minor, or major.
Use patch for a compatible fix, minor for a backward-compatible feature, and
major for a breaking public API change.

To inspect the package locally before merging:

```sh
bun run verify
npm pack --dry-run
```
