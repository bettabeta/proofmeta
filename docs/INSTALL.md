# Install

Prerequisites: Node.js >=18 with npm, on Linux x64 (the post-install check covers only that platform). On Node 18, prefix test and CLI commands with `NODE_OPTIONS=--experimental-global-webcrypto`.

From the root of a fresh clone (the first command rejects an existing `node_modules`, and npm must not start if it fails):

```sh
node scripts/version-p1-install-smoke.mjs --preinstall &&
  npm ci --ignore-scripts --no-audit &&
  node scripts/version-p1-install-smoke.mjs &&
  npm run build &&
  npm test
```

`npm test` runs the SDK, CLI, provider and consumer tests, then the end-to-end flow (`npm run e2e` runs only the last part). To run the reference provider and consumer yourself, use two terminals:

```sh
node examples/provider/server.mjs # serves http://127.0.0.1:4100/.well-known/proofmeta.json
node examples/consumer/client.mjs # requests a free-attribution license and verifies the signed chain
```

Check a file with the CLI, for example the provider's manifest:

```sh
curl -s http://127.0.0.1:4100/.well-known/proofmeta.json > manifest.json
node packages/cli/bin/proofmeta.mjs validate manifest.json
```

Why the install is pinned: [SUPPLY-CHAIN.md](./SUPPLY-CHAIN.md).
