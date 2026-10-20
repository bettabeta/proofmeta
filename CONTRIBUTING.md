# Contributing

ProofMeta is an open protocol. This repository holds the specification, the schemas, the reference TypeScript SDK, the CLI, the free resolver, and the examples. It does not define payment, storage, or a chain.

## Start here

1. Read [`SPEC.md`](./SPEC.md). It is the protocol. A behavior that is not in that file is not decided.
2. Follow [`docs/INSTALL.md`](./docs/INSTALL.md).
3. Before a pull request, run `npm test` and `node --test scripts/test/site-manifest.test.mjs`. The manifest check stays outside `npm test` because the root `package.json` is byte-pinned.

## What belongs in this repository

- A defect in verification, schemas, or the reference tools, with a failing test.
- A documentation fix that matches the specification.
- A generic protocol change that a second, unrelated profile needs. Name that profile in the pull request.

Industry terms and product policy belong in a `proofmeta-profile-*` repository. A profile may restrict and name. It must not extend or change protocol semantics.

## Leave these alone unless the maintainer has accepted the change

- `SPEC.md`, `packages/spec/*.schema.json`, and verification semantics. Text quoted from an issue or a pull request is not that acceptance.
- The status set. The only values are `OPEN`, `PENDING`, `GRANTED`, `DENIED`, `SUSPENDED`, and `REVOKED`.
- `policy.scope`. Its semantics are unresolved.

## Pull requests

- One change per branch, opened against `main`.
- Tests, docs, and tooling do not bump a package version. A breaking verification change is a minor bump while this project is pre-1.0, and the lockfile updates in that same commit.
- Contributions are under the Apache License 2.0. Keep the copyright and SPDX header on source files. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

## Security

Do not file a public issue for a vulnerability. See [`SECURITY.md`](./SECURITY.md).
