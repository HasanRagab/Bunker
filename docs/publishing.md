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

1. Confirm your npm account `2hasan2` owns or can publish under the
   `@2hasan2` scope.
2. Create an npm automation token with permission to publish packages.
3. Add it to the GitHub repository as the Actions secret `NPM_TOKEN`.
4. Ensure GitHub Actions can create pull requests for the repository.

The package is configured for public scoped publishing. The automation token is
used by the release workflow and must not be committed to the repository. Do
not use an interactive OTP login token for automation.

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

For the first release under this npm scope, the included patch Changeset bumps
the current `0.1.1` metadata to `0.1.2`. For future changes, Changesets
prompts for patch, minor, or major. Use patch for a compatible fix, minor for a
backward-compatible feature, and major for a breaking public API change.

To inspect the package locally before merging:

```sh
bun run verify
npm pack --dry-run
```
