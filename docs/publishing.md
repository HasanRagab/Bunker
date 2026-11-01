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

1. Confirm your npm account `2hasan2` owns or can publish under the `@2hasan2` scope.
2. Authenticate locally with `npm login`.
3. Check that `npm whoami` reports the account with publish permission.

The package is configured for public scoped publishing. No npm token is stored
in the repository or needed in CI. Keep your local npm credentials private.

## Release flow

1. Start from a clean, reviewed branch and commit the changes to release.
2. Run verification and inspect the package contents:

```sh
bun run verify
npm pack --dry-run
```

3. Choose exactly one version increment (this creates a Git commit and tag):

```sh
npm version patch   # compatible fix, e.g. 0.1.0 -> 0.1.1
npm version minor   # backwards-compatible feature, e.g. 0.1.0 -> 0.2.0
npm version major   # breaking API change, e.g. 0.1.0 -> 1.0.0
```

`npm version` updates `package.json`, creates a local git commit, and tags
it. It does not update `bun.lock`; that lockfile tracks dependencies, not
this package's release version. Do not run `npm version` with uncommitted
changes.

4. Publish the exact version from the tagged commit:

```sh
npm publish
```

npm runs the `prepublishOnly` typecheck/tests and `prepack` build hooks.

5. Push the release commit and tag:

```sh
git push
git push --tags
```

If publishing fails, check whether the version reached npm with
`npm view @2hasan2/bunker version`. If it was not published, you can fix the
problem and retry that version. If it is already listed, increment to a new
version; npm does not allow replacing a published version.

For the first release, publish the current `0.1.0` without running
`npm version`; after the first publish, choose patch/minor/major for each
release.
