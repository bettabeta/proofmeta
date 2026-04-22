# ProofMeta Resolvers

Reference resolver implementations. Each resolver is an independent npm workspace under `packages/resolvers/<name>/`.

The protocol defines resolvers on the wire only — entries in a Manifest's `resolvers` array and in a Request's `resolver_preferences`. The *programming* interface (how a Provider calls into a resolver) is an implementation concern of the reference Provider example, not part of the protocol core. Different languages, different stacks, different interfaces are all fine.

| Package | Role | Purpose |
|---|---|---|
| [`free/`](./free/) | payment | No-op resolver — instantly confirms. Used for Tier-1 free flows and integration tests. |

Chain-specific resolvers (Solana PDA, EVM anchors, …) live here once implemented — always as plug-in packages that depend on the SDK, never imported by the SDK itself.
