# @proofmeta/sdk-ts

Reference TypeScript SDK for the [ProofMeta Protocol](https://github.com/bettabeta/proofmeta). Create, sign, and verify the four primitives of the protocol: manifests, license requests, status updates, and the `in_reply_to` chains that connect them.

Chain-agnostic. No payment, delivery, or anchor code in core — those live behind the resolver interface in their own packages.

## Install

```
npm install @proofmeta/sdk-ts
```

## API surface

Anything received from the network or a file goes through `acceptProtocolInput`. That is the only function that reports `accepted`.

`verifyEnvelope` is crypto + actor checks only; not schema, transport, or acceptance. `verifyChain` applies that check to each envelope and then checks lifecycle links. Malformed input returns `{ ok: false, reason }` and does not throw.

```ts
import { readFile } from "node:fs/promises";
import { acceptProtocolInput } from "@proofmeta/sdk-ts/acceptance";
import {
  generateKeyPair,
  createEnvelope,
  verifyEnvelope,
  verifyChain,
} from "@proofmeta/sdk-ts";

const bytes = await readFile(new URL("./envelope.json", import.meta.url));
const report = await acceptProtocolInput(
  { kind: "bytes", bytes },
  { operation: "inspect-envelope", purpose: "inspection" },
);
// report.accepted === false for inspection. checks records ingress, schema, hash, and signature.

const kp = await generateKeyPair();
// → { did: "did:key:z6Mk...", publicKey, privateKey }

const envelope = await createEnvelope({
  payload: { type: "manifest", /* ... */ },
  author: kp.did,
  privateKey: kp.privateKey,
});

// crypto + actor checks only; not schema, transport, or acceptance
const v = await verifyEnvelope(envelope);
// → { ok: true } or { ok: false, reason: "..." }

const c = await verifyChain([open, pending, granted]);
```

## What gets verified

`verifyEnvelope` is crypto + actor checks only; not schema, transport, or acceptance. Before any hash or signature operation it rejects a `signature` other than `^ed25519:[a-f0-9]{128}$`, a `timestamp` whose suffix is not `Z`, `z`, or `+00:00`, and a `payload_hash` other than `^sha256:[a-f0-9]{64}$`.

It then checks:

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

## Migration notes

`@proofmeta/sdk-ts@0.5.0` exports the existing root API and `@proofmeta/sdk-ts/acceptance` (`acceptProtocolInput`). `npm run build` runs `scripts/build-acceptance-validators.mjs`, then `tsc`. `verifyEnvelope` and `verifyChain` remain crypto checks; they are not schema, transport, or authorization acceptance. Package version 0.5.0 implements the v1 draft; it does not declare the ProofMeta protocol v1 released.

Callers must distinguish validate/accept outcomes from crypto verification and preserve original raw input where required. Parsed values cannot guarantee original transport bytes. `policy.scope` semantics are not defined.

Requires Node >=18 and targets ES2022. On Node 18, crypto may require `NODE_OPTIONS=--experimental-global-webcrypto`.

Build/dev pins: `@proofmeta/spec` 0.4.0, Ajv 8.18.0, ajv-formats 3.0.1, esbuild 0.28.2 and TypeScript 5.7.3. They are not SDK runtime dependencies. The lock resolves Ajv's transitive fast-uri to 3.1.8 (including nested instances). CLI/demos consume the SDK, never the reverse. Building from a monorepo checkout: [docs/INSTALL.md](../../docs/INSTALL.md). Guarantees and trust prerequisites of the pinned install: [docs/SUPPLY-CHAIN.md](../../docs/SUPPLY-CHAIN.md). Pinned-artifact notices: [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

`@proofmeta/sdk-ts@0.6.0` keeps that split. `verifyEnvelope` and `verifyChain` fail closed on malformed input: signature syntax, the envelope timestamp UTC suffix, and `payload_hash` syntax return `{ ok: false, reason }` before crypto. They still do not report `accepted`.
