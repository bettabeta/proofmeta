# Reference Consumer Agent

Runs the full §6 flow end-to-end, exit 0 on success:

1. `GET {PROVIDER_ORIGIN}/.well-known/proofmeta.json` → verify the signed Manifest.
2. Pick the first inline item + its first `available_licenses` entry.
3. Generate a fresh ed25519 keypair + `did:key`, mint a UUID v7 `request_id`.
4. Sign an OPEN `license.request` envelope and POST it to `request_endpoint`.
5. Call `verifyChain` on the returned envelope chain.
6. Re-pull the latest envelope via `GET .../request/:request_id` and re-verify.

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
