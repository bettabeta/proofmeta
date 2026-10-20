# Install

## Just use the SDK

```sh
npm install @proofmeta/sdk-ts
```

See the [reference consumer](../examples/consumer/client.mjs) for the current manifest-to-license flow.

The SDK and examples use portable Node.js APIs. The pinned post-install smoke check below is Linux x64 only because it directly verifies the `@esbuild/linux-x64` binary. On Node 18, prefix test and CLI commands with `NODE_OPTIONS=--experimental-global-webcrypto`.

To build and test this repository from source:

From the root of a fresh clone (the first command rejects an existing `node_modules`, and npm must not start if it fails):

```sh
node scripts/version-p1-install-smoke.mjs --preinstall &&
  npm ci --ignore-scripts --no-audit &&
  node scripts/version-p1-install-smoke.mjs &&
  npm run build &&
  npm test
```

`npm test` runs the SDK, CLI, provider and consumer tests, the committed browser-bundle check, then the end-to-end flow (`npm run e2e` runs only the last part). To run the reference provider and consumer yourself, use two terminals:

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
