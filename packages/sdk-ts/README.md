# @proofmeta/sdk-ts

Reference TypeScript SDK for the [ProofMeta Protocol](https://github.com/bettabeta/proofmeta). Create, sign, and verify the four primitives of the protocol: manifests, license requests, status updates, and the `in_reply_to` chains that connect them.

Chain-agnostic. No payment, delivery, or anchor code in core — those live behind the resolver interface in their own packages.

## 0.5.0 migration and compatibility

`@proofmeta/sdk-ts@0.5.0` exports the existing root API and `@proofmeta/sdk-ts/acceptance` (`acceptProtocolInput`). `npm run build` runs `scripts/build-acceptance-validators.mjs`, then `tsc`. `verifyEnvelope` and `verifyChain` remain crypto checks; they are not schema, transport, or authorization acceptance. Package version 0.5.0 remains part of the v1 draft and does not declare the ProofMeta protocol v1 released.

Callers must distinguish validate/accept outcomes from crypto verification and preserve original raw input where required. Parsed values cannot guarantee original transport bytes. `policy.scope` semantics remain open; this remains a v1 draft. Independent QA and P2 runtime/packaging/release gates are not satisfied by this version bump.

Build/dev pins: `@proofmeta/spec` 0.4.0, Ajv 8.18.0, ajv-formats 3.0.1, esbuild 0.28.2 and TypeScript 5.7.3. They are not SDK runtime dependencies. The lock resolves Ajv's transitive fast-uri to 3.1.8 (including nested instances); refresh it deliberately and audit, do not copy a scratch lock. CLI/demos consume the SDK, never the reverse. Node >=18 and ES2022 remain unchanged; Node 18 crypto may require `NODE_OPTIONS=--experimental-global-webcrypto` and this requirement remains open, not repaired here. For a fresh monorepo checkout, run `node scripts/version-p1-install-smoke.mjs --preinstall && npm ci --ignore-scripts --no-audit` from the root before post-smoke/build/test/audit. The dependency-free PRE admits only the exact audited root/workspace/lock bytes; injected workspace prepare, local-directory/git and changed graphs fail before npm launch. This is not a malicious-checkout/TOCTOU sandbox or a policy for arbitrary published-package installs; see the root README for precise guarantees, trust prerequisites and the complete bounded sequence, and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for pinned-artifact notices.

## Install

```
npm install @proofmeta/sdk-ts
```

## API surface

Four functions cover the entire v1 protocol:

```ts
import {
  generateKeyPair,
  createEnvelope,
  verifyEnvelope,
  verifyChain,
} from "@proofmeta/sdk-ts";

// did:key + ed25519 keypair
const kp = await generateKeyPair();
// → { did: "did:key:z6Mk...", publicKey, privateKey }

// Sign any payload into a Signed Envelope
const envelope = await createEnvelope({
  payload: { type: "manifest", /* ... */ },
  author: kp.did,
  privateKey: kp.privateKey,
});

// Verify version + payload_hash + projection signature + core actor authority
const v = await verifyEnvelope(envelope);
// → { ok: true } or { ok: false, reason: "..." }

// Verify a lifecycle chain (OPEN → PENDING → GRANTED/DENIED/SUSPENDED …)
const c = await verifyChain([open, pending, granted]);
```

## What gets verified

`verifyEnvelope` checks four things:

1. `proofmeta: "1.0"`.
2. `payload_hash === sha256(JCS(payload))` — recomputed from scratch, not trusted from the envelope.
3. `signature` is a valid Ed25519 signature over the UTF-8 JCS serialization of exactly `proofmeta`, `payload_hash`, `author`, `timestamp`, and `in_reply_to` when present. `anchors` are excluded.
4. A manifest's `author` equals `payload.provider.id`, and a root OPEN license request's `author` equals `payload.consumer.id`.

`verifyChain` additionally checks that every `in_reply_to` matches the prior envelope's `payload_hash`, the root has no `in_reply_to`, all `request_id`s in the chain agree, every license-chain status update is authored by the root OPEN's `payload.provider_id`, and status transitions follow the allowed lifecycle (including `SUSPENDED` / reinstatement). Root attestations retain their asserting authority semantics. Use `isCurrentlyValid(chain)` for read-time validity; expiry is derived from optional `valid_until` on `GRANTED` envelopes, not a stored status.

## Canonicalization

Payloads are canonicalized per [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) before hashing, so two envelopes with different key orders but the same semantic payload have the same `payload_hash`.

## Identity

v1 requires `did:key` with ed25519. Other DID methods can be supported by passing a `resolveAuthor(did)` callback to `verifyEnvelope`.

## License

Apache-2.0. See [LICENSE](https://github.com/bettabeta/proofmeta/blob/main/LICENSE).
