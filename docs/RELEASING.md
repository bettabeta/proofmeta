# Releasing

Merging a version bump to `main` releases it. [`release.yml`](../.github/workflows/release.yml) sees the raised `version`, installs, runs the full suite, publishes through npm trusted publishing with provenance, and then tags the merged commit `<package>@<version>`. No npm token exists or is accepted; every package is set to "Require two-factor authentication and disallow tokens".

| Tag prefix      | npm package                | Directory                 |
| --------------- | -------------------------- | ------------------------- |
| `spec`          | `@proofmeta/spec`          | `packages/spec`           |
| `sdk-ts`        | `@proofmeta/sdk-ts`        | `packages/sdk-ts`         |
| `resolver-free` | `@proofmeta/resolver-free` | `packages/resolvers/free` |
| `cli`           | `@proofmeta/cli`           | `packages/cli`            |

## Steps

1. In a PR, raise `version` in the package's `package.json` (semver, see `AGENTS.md`). In the same commit, update the workspace version in `package-lock.json` and the two matching SHA-256 pins in `scripts/version-p1-install-smoke.mjs`; the install check rejects any other manifest or lock change.
2. Squash-merge the PR.
3. Watch the `release` run under Actions (jobs `plan`, `publish`, `tag`), then check the registry:

   ```sh
   npm view @proofmeta/<package>@<version> version dist.attestations.provenance
   ```

   npm may answer `E404` for a minute after a successful publish.

A version with a prerelease suffix (`1.2.3-rc.1`) is published under the dist-tag `next`, everything else under `latest`.

## Order

A package can only publish once its `@proofmeta` dependencies satisfy the declared range on npm. One merge may raise several packages: the run publishes them in this order and waits up to five minutes for each dependency to appear on npm:

1. `spec`
2. `sdk-ts`
3. `resolver-free`, `cli`

## Manual tag

Pushing a tag still releases that one package, for example to publish a version that is already on `main`:

```sh
git fetch origin main --tags
git tag <package>@<version> origin/main
git push origin <package>@<version>
```

## The run refuses to publish when

- the commit is not on `main`,
- a `version` in a releasable `package.json` went down or is not semver,
- the push to `main` does not extend the previous `main` (force push),
- the tag names an unknown package, is not semver, or does not match `version` in `package.json`,
- the tag already exists on a different commit,
- the version is already on npm from a different commit (the same commit is skipped),
- an `@proofmeta` dependency is not on npm after five minutes,
- the install check, `npm test`, `scripts/test/*.test.mjs`, or `npm audit` fails.

If the cause is outside the commit (a dependency not yet on npm, a registry or auth outage), re-run the failed jobs; packages already published from the same commit are skipped and the tags follow. If the commit itself is wrong, fix it on `main` and release a new version. Never move a pushed tag or reuse a version.

## Trusted publisher

Each package on npmjs.com has exactly one trusted publisher. All fields are case-sensitive:

| Field             | Value         |
| ----------------- | ------------- |
| Organization      | `bettabeta`   |
| Repository        | `proofmeta`   |
| Workflow filename | `release.yml` |
| Environment       | `npm-publish` |

`ENEEDAUTH` at the publish step means one of these values does not match the run.

The `tag` job creates tags with the workflow's `GITHUB_TOKEN` (`contents: write`). Such tags do not start another `release` run.
