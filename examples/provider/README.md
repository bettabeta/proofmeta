# Reference Provider Agent

Minimal, chain-agnostic ProofMeta Provider — the thing §6 of the master spec describes, ~300 lines of Node using only the SDK, the Free resolver, and `node:http`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/.well-known/proofmeta.json` | Returns the signed Manifest envelope. |
| `POST` | `/api/proofmeta/request` | Accepts a signed OPEN envelope. Verifies it, runs the Free resolver, signs PENDING + GRANTED (or DENIED), returns the full chain. |
| `GET` | `/api/proofmeta/request/:request_id` | Returns the latest envelope. `?full=true` returns the whole chain. |

## Run

```bash
# from repo root
npm run build
node examples/provider/server.mjs
# PORT=4100 HOST=127.0.0.1 PUBLIC_ORIGIN=http://127.0.0.1:4100 by default
```

## Scope

Tier-1 only — pure signatures, no anchors, no external payment. State is in-memory (`Map<request_id, Envelope[]>`), keypair is generated fresh on startup. For anything persistent or production-facing, swap the storage and key-handling layers; the envelope handling itself doesn't change.
