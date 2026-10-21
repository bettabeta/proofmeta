# ProofMeta documentation

`SPEC.md` at the repository root is the protocol. Everything here explains how to use it. Pick your role.

## Start here

| You want to…                                                                  | Read                                                     | Tools                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Tell AI agents what they may do with what you publish, without writing code   | [publish-a-policy.md](./publish-a-policy.md)             | [Manifest Generator](https://www.proofmeta.com/generate), `npx @proofmeta/cli init` |
| Make your site, API or agent a **Provider** that answers license requests     | [become-a-provider.md](./become-a-provider.md)           | `@proofmeta/sdk-ts`, `examples/provider`                                            |
| Make your agent a **Consumer** that discovers, requests and verifies licenses | [build-a-consumer.md](./build-a-consumer.md)             | `@proofmeta/sdk-ts`, `examples/consumer`, `npx @proofmeta/cli fetch`                |
| Implement the protocol in another language                                    | [implement-the-protocol.md](./implement-the-protocol.md) | `packages/spec` schemas and vectors                                                 |

## Reference

- [`SPEC.md`](../SPEC.md) — normative text, decisions D1–D19
- [scope-vocabulary.md](./scope-vocabulary.md) — the eight core scope tags and URL extensions
- [terminology.md](./terminology.md) — shared vocabulary
- [architecture.md](./architecture.md) — core vs. adapters vs. extensions vs. applications
- [`packages/spec`](../packages/spec) — JSON Schemas, [`vectors/`](../packages/spec/vectors) conformance corpus
- [use-cases/](./use-cases/README.md) — where domain profiles live (not here)

## Building, releasing, process

- [INSTALL.md](./INSTALL.md) — build this repository from source (contributors)
- [SUPPLY-CHAIN.md](./SUPPLY-CHAIN.md) — why the source install is pinned, what it guarantees
- [RELEASING.md](./RELEASING.md) — tags, order, trusted publisher
- [MILESTONE-SCOPE-FREEZE.md](./MILESTONE-SCOPE-FREEZE.md) — the frozen security-first v1 milestone
- [attestation-extension-proposal.md](./attestation-extension-proposal.md) — background to D14 (root attestations)
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../SECURITY.md`](../SECURITY.md), [`../CHANGELOG.md`](../CHANGELOG.md)

Using the published packages needs none of the process documents: `npm install @proofmeta/sdk-ts`, `npx @proofmeta/cli`.
