# ProofMeta

> The permission layer for the agentic web — an open protocol that lets any AI agent discover, request, and use licensed items from any other AI agent, with machine-readable terms and a status lifecycle.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: v1 Draft](https://img.shields.io/badge/Status-v1_Draft-yellow)]()
[![CI](https://github.com/bettabeta/proofmeta/actions/workflows/ci.yml/badge.svg)](https://github.com/bettabeta/proofmeta/actions/workflows/ci.yml)

**Status:** v1 draft. `free-attribution` licensing runs end to end; a payment resolver is planned for v1.1.

[Website](https://www.proofmeta.com/) · [Manifest Generator](https://www.proofmeta.com/generate) · [Verifier](https://www.proofmeta.com/verify) · [Specification](./SPEC.md) · [Documentation](./docs/README.md)

---

## Where to start

| You are… | Start with | Tool |
|---|---|---|
| Publishing content, data or tools and want agents to know your terms | [docs/publish-a-policy.md](./docs/publish-a-policy.md) | [Generator](https://www.proofmeta.com/generate) or `npx @proofmeta/cli init` |
| Building a site, API or agent that answers license requests | [docs/become-a-provider.md](./docs/become-a-provider.md) | `npm install @proofmeta/sdk-ts` |
| Building an agent that reads terms and requests licenses | [docs/build-a-consumer.md](./docs/build-a-consumer.md) | `npm install @proofmeta/sdk-ts`, `npx @proofmeta/cli fetch <domain>` |
| Implementing the protocol in another language | [docs/implement-the-protocol.md](./docs/implement-the-protocol.md) | `packages/spec` schemas and vectors |

---

## Try ProofMeta in 60 seconds

No install, account, or email required:

1. [Verify proofmeta.com's own signed manifest](https://www.proofmeta.com/verify?url=/.well-known/proofmeta.json).
2. Inspect who signed it, which payload hash was signed, and which license scopes it declares.
3. [Open the Manifest Generator](https://www.proofmeta.com/generate) to create a key and build your own manifest locally in the browser.

The generator keeps the private key in your browser and self-checks the signed result. When you are ready to publish, host the downloaded file at `https://your-domain/.well-known/proofmeta.json`.

## What you get today

- A signed manifest identifies the publishing `did:key` and binds each license type to its exact terms through `terms_hash`.
- Static catalog items can include `content_hash`, so a consumer can compare delivered bytes with the item it licensed.
- Every license request is a signed envelope that records which consumer requested which item and terms.
- A provider can answer `DENIED`, suspend a grant with `SUSPENDED`, or permanently withdraw it with `REVOKED`.
- Anyone with the manifest and request URL can verify the signed lifecycle chain again.

Payment is planned for v1.1; until then, the runnable license is free use with attribution.

## License a capability you already ship

You have something another agent can use: a tool, a dataset, or a skill pack. ProofMeta is the file you publish so that agent can find it, check who signed the terms, and ask for a license.

The path that runs today is free use with attribution (`free-attribution`). A payment resolver is planned for v1.1.

1. [Create a key and a manifest](https://www.proofmeta.com/generate) in the browser.
2. Name the item and one license type. The reference provider uses `free-attribution`.
3. Host the signed file at `https://your-domain/.well-known/proofmeta.json`.
4. Accept license requests at the `request_endpoint` in that manifest. Answer with a signed status: `PENDING`, then `GRANTED` or `DENIED`.
5. A consumer fetches the manifest URL, checks the signature, and POSTs a signed request.

The consumer that does this today is the reference agent in this repo.

```bash
# from a checkout of this repo, after the install in docs/INSTALL.md
node examples/provider/server.mjs
PROVIDER_ORIGIN=http://127.0.0.1:4100 node examples/consumer/client.mjs
```

`examples/provider` serves the manifest and grants `free-attribution`. `examples/consumer` is the agent that reads `/.well-known/proofmeta.json` and completes the request. `npm run e2e` runs both.

### Use a licensed capability from your agent

```js
import { generateKeyPair, requestLicense } from "@proofmeta/sdk-ts";

const keyPair = await generateKeyPair();
const result = await requestLicense({
  manifestUrl: "https://example.com/.well-known/proofmeta.json",
  itemId: "item-001",
  licenseType: "free-attribution",
  keyPair,
  pollTimeoutMs: 30_000,
});
if (!result.ok) throw new Error(result.reason);
```

`requestLicense` fetches and accepts the signed manifest, submits a signed request, polls the provider, and returns only after verifying the returned chain.

## What is ProofMeta?

ProofMeta is a **protocol**, not a platform. It defines what agents say to each other when licensing content or capabilities. It never defines how money moves, where files are stored, or which blockchain is used.

One primitive, the **Signed Envelope**: `did:key`, a [JCS (RFC 8785)](https://www.rfc-editor.org/rfc/rfc8785) hash, and an ed25519 signature. Discovery in this draft is one HTTPS GET, usually `/.well-known/proofmeta.json`.

- **Provider** — publishes a manifest and offers licensed items
- **Consumer** — fetches that manifest, requests a license, and checks the signed answer
- **Resolver** — an external service for payment, delivery, or verification. The reference implementation is the free resolver.

## Status lifecycle

```
OPEN → PENDING → GRANTED | DENIED
                 GRANTED → SUSPENDED → GRANTED (reinstate)
                 GRANTED → REVOKED (optional)
                 SUSPENDED → REVOKED (escalate)
```

A signed status answers a license request and records its current lifecycle state.

## Also: attestations

A `status.update` can also stand alone as an attestation: a signed verdict about a subject against a policy, with no prior license request. Attestation histories use the same signed-envelope primitive; see [SPEC.md §3.4.1](./SPEC.md#341-two-modes-of-a-status-chained-verdict-and-root-attestation).

## Manifest shape

Every artifact is a Signed Envelope. The manifest is the `payload`:

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "manifest",
    "provider": {
      "id": "did:key:z6Mkh...",
      "name": "Your Agent Name"
    },
    "request_endpoint": "https://youragent.ai/api/proofmeta/request",
    "catalog_endpoint": "https://youragent.ai/api/proofmeta/catalog",
    "resolvers": [
      { "role": "payment",  "id": "none" },
      { "role": "delivery", "id": "https" },
      { "role": "anchor",   "id": "none" }
    ],
    "license_types": [
      {
        "id": "free-attribution",
        "terms_url": "https://youragent.ai/terms/free",
        "terms_hash": "sha256:...",
        "scope": ["non-commercial", "attribution-required"]
      }
    ]
  },
  "payload_hash": "sha256:...",
  "author": "did:key:z6Mkh...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-21T10:00:00Z"
}
```

A consumer polls `GET {request_endpoint}/{request_id}` for the latest envelope, or `?full=true` for the whole chain. Normative text: [`SPEC.md`](./SPEC.md). Scope tags: [`docs/scope-vocabulary.md`](./docs/scope-vocabulary.md).

The resolver that ships here declares `{ "role": "payment", "id": "none" }` and performs no payment.

A payment resolver entry (for example, Stripe) is planned for v1.1.

## Install

Use the published packages; no checkout needed:

```sh
npm install @proofmeta/sdk-ts          # create, sign, verify, accept envelopes; requestLicense()
npx @proofmeta/cli fetch example.com   # read and verify a published manifest
npx @proofmeta/cli validate chain.json # diagnose any envelope or chain
```

Node >= 18; on Node 18 set `NODE_OPTIONS=--experimental-global-webcrypto`.

Current tree versions: `@proofmeta/sdk-ts` 0.7.0, `@proofmeta/cli` 0.6.0, `@proofmeta/spec` 0.4.0, `@proofmeta/resolver-free` 0.3.0. SDK 0.7.0 is not published by this change; npm publishing follows the release workflow.

Building this repository from source (reference provider and consumer, tests, the browser bundle) uses a pinned, audited install sequence meant for contributors: [CONTRIBUTING.md](./CONTRIBUTING.md), [docs/INSTALL.md](./docs/INSTALL.md). The SDK and examples use portable Node.js APIs; only that pinned post-install smoke check is limited to Linux x64.

## Repository structure

```
/SPEC.md                → specification
/packages/spec          → JSON Schemas (manifest, request, status)
/packages/sdk-ts        → TypeScript SDK
/packages/cli           → proofmeta validate
/packages/resolvers     → reference resolver implementations
/examples/provider      → demo provider
/examples/consumer      → demo consumer (reads /.well-known/proofmeta.json)
/site                   → browser generator, verifier, and protocol website
/docs                   → supporting documentation
```

## What the v1 draft implements

This is a working v1 draft. A provider can publish a manifest, a consumer can request a license, and anyone can re-check the envelope chain from the manifest URL.

- [x] Manifest, license-request, and status-update schemas
- [x] Status lifecycle: `OPEN → PENDING → {GRANTED | DENIED}`; from `GRANTED`: `SUSPENDED` or terminal `REVOKED`; from `SUSPENDED`: `GRANTED` or terminal `REVOKED`; `DENIED` is terminal
- [x] TypeScript SDK — ed25519 signing, JCS hashing, envelope and chain verification
- [x] Free-license resolver
- [x] Demo provider and consumer
- [x] Validator CLI (`proofmeta validate <file>`)

Planned for v1.1: one payment resolver. Until that ships, the runnable license is `free-attribution`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Report vulnerabilities in private: [SECURITY.md](./SECURITY.md). History that is not part of the protocol lives in [CHANGELOG.md](./CHANGELOG.md).

## License

Copyright © 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.
