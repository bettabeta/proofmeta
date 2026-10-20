# Releasing

Each npm package is released by pushing one tag `<package>@<version>` to a commit on `main`. [`release.yml`](../.github/workflows/release.yml) then installs, runs the full suite, and publishes through npm trusted publishing with provenance. No npm token exists or is accepted; every package is set to "Require two-factor authentication and disallow tokens".

| Tag prefix      | npm package                | Directory                 |
| --------------- | -------------------------- | ------------------------- |
| `spec`          | `@proofmeta/spec`          | `packages/spec`           |
| `sdk-ts`        | `@proofmeta/sdk-ts`        | `packages/sdk-ts`         |
| `resolver-free` | `@proofmeta/resolver-free` | `packages/resolvers/free` |
| `cli`           | `@proofmeta/cli`           | `packages/cli`            |

## Steps

1. In a PR, bump `version` in the package's `package.json` (semver, see `AGENTS.md`). In the same commit, update the workspace version in `package-lock.json` and the two matching SHA-256 pins in `scripts/version-p1-install-smoke.mjs`; the install check rejects any other manifest or lock change.
2. Squash-merge the PR.
3. Tag the squash commit and push the tag:

   ```sh
   git fetch origin main --tags
   git tag <package>@<version> origin/main
   git push origin <package>@<version>
   ```

4. Watch the `release` run under Actions, then check the registry:

   ```sh
   npm view @proofmeta/<package>@<version> version dist.attestations.provenance
   ```

   npm may answer `E404` for a minute after a successful publish.

A version with a prerelease suffix (`1.2.3-rc.1`) is published under the dist-tag `next`, everything else under `latest`.

## Order

A package can only publish once its `@proofmeta` dependencies satisfy the declared range on npm. When several packages change, tag them one at a time and wait for each run to succeed:

1. `spec`
2. `sdk-ts`
3. `resolver-free`, `cli`

## The run refuses to publish when

- the tagged commit is not on `main`,
- the tag names an unknown package, is not semver, or does not match `version` in `package.json`,
- the version is already on npm,
- an `@proofmeta` dependency is not on npm yet (publish it, then re-run the failed job),
- the install check, `npm test`, `scripts/test/*.test.mjs`, or `npm audit` fails.

If the cause is outside the commit (a dependency not yet on npm, a registry or auth outage), re-run the failed job. If the commit itself is wrong, fix it on `main` and release a new version. Never move a pushed tag or reuse a version.

## Trusted publisher

Each package on npmjs.com has exactly one trusted publisher. All fields are case-sensitive:

| Field             | Value         |
| ----------------- | ------------- |
| Organization      | `bettabeta`   |
| Repository        | `proofmeta`   |
| Workflow filename | `release.yml` |
| Environment       | `npm-publish` |

`ENEEDAUTH` at the publish step means one of these values does not match the run.
