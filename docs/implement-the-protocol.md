# Implement the protocol in another language

For anyone writing a ProofMeta implementation outside the reference TypeScript SDK. The protocol is small on purpose: one envelope format, three payload types, one state machine. `SPEC.md` is normative; this page is the implementer's map of it and of the test material in this repository.

## What you need

| Building block                       | Where it is specified                                           | Libraries you can reuse                                                                   |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| JSON Canonicalization Scheme         | RFC 8785 (`SPEC.md` §3.1, D1)                                   | `canonicalize` (JS), `rfc8785` (Python), `json-canonicalization` (Go), `serde_jcs` (Rust) |
| SHA-256, `sha256:<64 lowercase hex>` | §3.1                                                            | any                                                                                       |
| Ed25519                              | §3.1 (D3)                                                       | libsodium, `ed25519-dalek`, `cryptography`, …                                             |
| `did:key` for Ed25519                | §3.1: `did:key:z` + base58btc(`0xed 0x01` ‖ 32-byte public key) | multibase/multicodec helpers or 20 lines of code                                          |
| JSON Schema draft-07                 | [`packages/spec/*.schema.json`](../packages/spec)               | Ajv, `jsonschema`, `gojsonschema`, …                                                      |

## The envelope

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "manifest | license.request | status.update",
    "...": "…"
  },
  "payload_hash": "sha256:…",
  "author": "did:key:z6Mk…",
  "signature": "ed25519:<128 lowercase hex>",
  "timestamp": "2026-09-04T10:00:00Z",
  "in_reply_to": "sha256:…   (only on non-roots)",
  "anchors": ["…optional, never signed by the author (D17)…"]
}
```

Signing (D16):

1. `payload_hash = "sha256:" + hex(sha256(utf8(JCS(payload))))`
2. Build the **signing projection**: exactly `proofmeta`, `payload_hash`, `author`, `timestamp`, and `in_reply_to` if and only if it is present on the envelope. Nothing else.
3. `signature = "ed25519:" + hex(ed25519_sign(private_key, utf8(JCS(projection))))`

Verifying is the reverse, fail-closed: recompute `payload_hash` from `payload` and compare; reconstruct the projection from the received envelope and verify the signature with the key decoded from `author`. Never fall back to the pre-D16 "sign only the hash string" rule; a legacy envelope is invalid, not "legacy-valid".

## Order of checks

The reference SDK applies one ordered decision model to every untrusted input, and reports the first failure with a stable code. Matching this order makes your rejections comparable with the vectors.

1. **Ingress** (bytes): valid UTF-8; no leading BOM (`EF BB BF`); JSON without duplicate keys; numbers within the JSON domain. Codes `UTF8_INVALID`, `BOM_UNSUPPORTED`, `JSON_SYNTAX`, `JSON_DUPLICATE_KEY`, `JSON_DOMAIN`.
2. **Schema**: `envelope.schema.json`, then the payload schema selected by `payload.type`. Envelope `timestamp` must end in `Z`, `z` or `+00:00`. `SCHEMA_INVALID`, `PAYLOAD_UNSUPPORTED`.
3. **Hash**: recomputed `payload_hash` equals the field. `HASH_MISMATCH`.
4. **Signature**: Ed25519 over the projection. `SIGNATURE_INVALID`.
5. **Authority** (D18): manifest `author == payload.provider.id`; root `license.request` `author == payload.consumer.id`; every `status.update` in a license chain is authored by the root's `payload.provider_id`; every entry of an attestation chain is authored by the root's author. `AUTHORITY_MISMATCH`.
6. **Context**: root has no `in_reply_to`; each `in_reply_to` equals the previous `payload_hash`; one `request_id` per chain; transitions legal; a `status.update` is either a license verdict (`request_id`) or a root attestation (`subject` + `policy`), never both; `SUSPENDED`/`REVOKED` carry a `reason`. `ROOT_INVALID`, `PARENT_MISMATCH`, `CONTEXT_MISMATCH`, `TRANSITION_INVALID`, `MODE_INVALID`.
7. **Manifest scope** (D11): every `license_types[].scope` has at least one core tag; the other entries are absolute URLs; no conflict pair (`commercial`/`non-commercial`, `ai-training-allowed`/`ai-training-excluded`). `SCOPE_INVALID`.

Everything after a failure is "not checked", not "passed". Separate crypto verification from acceptance in your API, as the SDK does (`verifyEnvelope` vs. `acceptProtocolInput`); only the latter may say "accepted".

## State machine

```
OPEN → PENDING → GRANTED | DENIED
GRANTED → SUSPENDED → GRANTED        (reinstate)
GRANTED → REVOKED
SUSPENDED → REVOKED
```

`DENIED` and `REVOKED` are terminal. Expiry is derived from `valid_until` on `GRANTED` at read time; it is not a status. The status set is closed: `OPEN, PENDING, GRANTED, DENIED, SUSPENDED, REVOKED`.

## Test material

- [`packages/spec/test-vectors/envelope-signing-v1.json`](../packages/spec/test-vectors/envelope-signing-v1.json) — deterministic keys, projections and expected signatures for D16. Start here; if these pass, your canonicalization and signing are right.
- [`packages/spec/vectors/`](../packages/spec/vectors) — 15 language-neutral cases: valid manifest, OPEN, status, chain; and invalid cases for mutated timestamp, rewired `in_reply_to`, missing timestamp, legacy signature, author mismatches, attacker-signed status, attestation mode errors. Each file has `input` and `expect: { valid, reason }`.
- [`packages/sdk-ts/test/fixtures/strict-json/cases.json`](../packages/sdk-ts/test/fixtures/strict-json/cases.json) — raw-byte ingress cases (duplicates, BOM, number domain).
- `packages/sdk-ts/test/` — the SDK's own adversarial tests, useful as a specification by example.

Keys in these files are public test material and must never be used for anything else.

## Checking your output against the reference

```sh
npx @proofmeta/cli validate envelope-or-chain.json --json
npx @proofmeta/cli accept manifest.json --operation manifest --purpose protocol-conformance
npx @proofmeta/cli accept chain.json --operation license-chain --purpose protocol-conformance
```

`accept` prints the SDK's full report (`checks`, `errors` with code and JSON path). Envelopes your implementation signs must be accepted by it, and envelopes it rejects must be rejected by yours with the same first code.

## Scope of a conforming implementation

Minimum: envelope create/verify, the three payload schemas, chain verification with the authority and transition rules, manifest scope validation, and fail-closed byte ingress. Not part of the protocol, so not part of conformance: payment, delivery, anchors beyond their shape, registries, `policy.scope` semantics (explicitly unresolved).

Industry-specific vocabularies belong in a `proofmeta-profile-*` repository ([use-cases/](./use-cases/README.md)); a profile may restrict and name, never extend protocol semantics. If you find a point where `SPEC.md` and the reference SDK disagree, open an issue; the specification wins and the code gets fixed, not the other way round.
