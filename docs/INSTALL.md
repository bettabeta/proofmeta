# Install

## Use the published packages

```sh
npm install @proofmeta/sdk-ts     # library: envelopes, acceptance, requestLicense()
npx @proofmeta/cli --help         # init, keygen, hash, sign, fetch, accept, validate
```

Nothing below is needed for that. Role guides: [publish-a-policy.md](./publish-a-policy.md), [become-a-provider.md](./become-a-provider.md), [build-a-consumer.md](./build-a-consumer.md). API detail: [`packages/sdk-ts/README.md`](../packages/sdk-ts/README.md), [`packages/cli/README.md`](../packages/cli/README.md).

The SDK and examples use portable Node.js APIs. On Node 18, prefix test and CLI commands with `NODE_OPTIONS=--experimental-global-webcrypto`.

## Build this repository from source

For contributors and anyone who wants to run the reference provider and consumer, the test suite, or rebuild the browser bundle. The install is pinned: `package.json` and the lockfile are byte-checked, and a post-install gate verifies the dependency graph. That gate is Linux x64 only because it directly verifies the `@esbuild/linux-x64` binary; on other platforms you can still `npm ci --ignore-scripts && npm run build`, without the gate's guarantee.

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

Check the running provider with the CLI from the checkout:

```sh
node packages/cli/bin/proofmeta.mjs fetch http://127.0.0.1:4100
curl -s http://127.0.0.1:4100/.well-known/proofmeta.json > manifest.json
node packages/cli/bin/proofmeta.mjs validate manifest.json
```

Why the install is pinned: [SUPPLY-CHAIN.md](./SUPPLY-CHAIN.md).
