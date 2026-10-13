# Reference Consumer Agent

Runs the full §6 flow end-to-end, exit 0 on success:

1. `GET {PROVIDER_ORIGIN}/.well-known/proofmeta.json` → verify the signed Manifest.
2. Pick the first inline item + its first `available_licenses` entry.
3. Generate a fresh ed25519 keypair + `did:key`, mint a UUID v7 `request_id`.
4. Sign an OPEN `license.request` envelope and POST it to `request_endpoint`.
5. Strictly parse the raw POST `{chain}` wrapper, then use SDK `consumer-response`
   acceptance with the sent OPEN, verified Manifest, Provider, item, license and
   terms hash. Consume only the accepted detached snapshot.
6. Read GET as raw bytes. Accept the same signed head (anchors excluded from
   identity), or verify a continuation of the already accepted chain. A request
   ID alone is not sufficient; a rollback or replacement head fails closed.

Manifest, POST and GET use `arrayBuffer`, strict UTF-8/JSON ingress (including
rejection of BOM and duplicate decoded keys), schema and cryptographic checks.
No terms/delivery fetches or anchor/time trust are claimed. `valid_until` retains
its existing schema semantics; this adapter adds no UTC-only rule to that field.

## Tests

`npm test` from the root runs the actual consumer Node test suite as well as SDK,
CLI, Provider and E2E. `npm run test -w @proofmeta/example-consumer` runs only the
consumer regressions after building the SDK. The exercised Node 18 runtime is
18.20.8; the inherited `>=18` engine declaration is not a claim that Node 18.0's
experimental test runner supports this command. Tests use loopback HTTP200
servers and actual consumer/CLI subprocess exits, plus shared signed context
fixtures. No externally fetched terms or delivery data is used.

## Run

```bash
# in one terminal
node examples/provider/server.mjs

# in another
PROVIDER_ORIGIN=http://127.0.0.1:4100 node examples/consumer/client.mjs
```

Or run both in one go:

```bash
npm run e2e     # from repo root
```
