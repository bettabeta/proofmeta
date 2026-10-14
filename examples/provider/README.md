# Reference Provider Agent

Minimal, chain-agnostic ProofMeta Provider — the thing §6 of the master spec describes, ~300 lines of Node using only the SDK, the Free resolver, and `node:http`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/.well-known/proofmeta.json` | Returns the signed Manifest envelope. |
| `POST` | `/api/proofmeta/request` | Accepts raw bytes using SDK `provider-open` for this Provider, then checks the selected item/license/terms, runs the Free resolver, signs PENDING + GRANTED (or DENIED), returns the full chain. |
| `GET` | `/api/proofmeta/request/:request_id` | Returns the latest envelope. `?full=true` returns the whole chain. |

## Run

```bash
# from repo root
npm run build
node examples/provider/server.mjs
# PORT=4100 HOST=127.0.0.1 PUBLIC_ORIGIN=http://127.0.0.1:4100 by default
```

## Acceptance and replay boundary

POST preserves bytes without decoding or JSON reparsing before
`@proofmeta/sdk-ts/acceptance`: operation `provider-open`, purpose
`protocol-conformance`, `expectedProvider` is this process's DID. The accepted
detached snapshot is the input to business checks and processing. Invalid UTF-8,
leading BOM, duplicate decoded JSON keys, malformed JSON, schema/signature,
authority, root and Provider-context failures return HTTP 400 with
`{ "error": "invalid protocol input", "code": "<SDK code>" }`, without the
raw body, report snapshot, key material or unbounded diagnostic text.
Business rejections remain HTTP 400. Neither kind reserves a request ID or
calls the payment resolver: a corrected valid request with the same ID can succeed.

After all validation, the existing synchronous check/reservation is one-shot
and process-local. Concurrent identical IDs produce exactly one processing
attempt and HTTP 409 for the rest. A processing failure retains its reservation;
it does not publish a partial chain. Restart clears state; there is no TTL,
persistence or multi-instance replay guarantee. GET exposes only completed chains.

Node 18 requires the existing runtime flag, also for test child processes:
`NODE_OPTIONS=--experimental-global-webcrypto node examples/provider/server.mjs`.
This adapter does not install a crypto global or change runtime support.

## Scope

Tier-1 only — pure signatures, no anchors, no external payment. State is in-memory (`Map<request_id, Envelope[]>`), keypair is generated fresh on startup. For anything persistent or production-facing, swap the storage and key-handling layers; the envelope handling itself doesn't change.
