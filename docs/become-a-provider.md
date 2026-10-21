# Become a Provider

For developers who run a site, API or agent and want to answer license requests with signed statuses instead of a static page. A Provider publishes a manifest and operates the `request_endpoint` it declares. Normative text: `SPEC.md` §3.3, §3.4, §3.6, §6. Working reference: [`examples/provider/server.mjs`](../examples/provider/server.mjs), ~280 lines on `node:http`.

If you only want to publish terms and do not need to issue signed grants, [publish-a-policy.md](./publish-a-policy.md) is enough.

## What a Provider operates

| Method | Path                              | Behaviour                                                                 |
| ------ | --------------------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/.well-known/proofmeta.json`     | The signed manifest. Any URL works, this one is the discovery convention. |
| `POST` | `{request_endpoint}`              | Accepts a signed `OPEN` envelope, answers with the signed chain.          |
| `GET`  | `{request_endpoint}/{request_id}` | Latest envelope for that lifecycle; `?full=true` returns the whole chain. |

Everything you return is a Signed Envelope authored by your `did:key`. The Consumer verifies each one; a status you did not sign is rejected (D18).

## Steps

### 1. A key

```sh
npx @proofmeta/cli keygen --out provider-key.json      # prints did:key:z6Mk…
```

or in code: `generateKeyPair()` from `@proofmeta/sdk-ts`. The DID is `provider.id` in the manifest and `author` of every envelope you sign. Keep the private key where your server can read it; everything else is public.

### 2. A manifest

Required: `provider.id` (your DID), `request_endpoint`, `license_types[]` (each with `id`, `terms_url`, `terms_hash`, `scope`), and either inline `items[]` or a `catalog_endpoint` (§3.8). `terms_hash` is `sha256:` of the exact bytes served at `terms_url` (`npx @proofmeta/cli hash terms.txt`). Static items should carry `content_hash` (D13).

Sign it with `createEnvelope({ payload, author: did, privateKey })` or `npx @proofmeta/cli sign manifest-payload.json --key provider-key.json --out proofmeta.json`. Both self-check with the same acceptance the Consumer applies.

### 3. Accept requests fail-closed

Read the POST body as bytes, never as parsed JSON, and hand the bytes to the SDK:

```js
import { acceptProtocolInput } from "@proofmeta/sdk-ts/acceptance";

const report = await acceptProtocolInput(
  { kind: "bytes", bytes },
  {
    operation: "provider-open",
    purpose: "protocol-conformance",
    expectedProvider: myDid,
  },
);
if (!report.accepted)
  return respond(400, {
    error: "invalid protocol input",
    code: report.errors[0].code,
  });
const open = report.snapshot; // detached, frozen; use only this from here on
```

That one call covers UTF-8/BOM/duplicate-key ingress, schema, `payload_hash`, signature over the D16 projection, `author == consumer.id`, root shape, and `provider_id == expectedProvider`. Cap the body size before reading (the reference uses 64 KiB) and do not echo raw bodies or report snapshots in error responses.

Then your business checks on `open.payload`: known `license_type`, `terms_hash` equal to your current terms, known `item_id`, item offers that license. Reject with 400. None of these reserve the `request_id`, so a corrected request with the same ID can succeed.

### 4. Answer with a signed chain

```js
import { updateStatus } from "@proofmeta/sdk-ts";

const pending = await updateStatus(open, "PENDING", myDid, privateKey, {
  note: "checking",
});
// decide: resolver result, your own policy, a human, …
const granted = await updateStatus(pending, "GRANTED", myDid, privateKey, {
  delivery: {
    method: "https",
    url: `https://you.example/deliver/${open.payload.request_id}`,
  },
});
respond(200, { chain: [open, pending, granted] });
```

`updateStatus` sets `in_reply_to` to the prior envelope's `payload_hash` and copies `request_id`. Allowed transitions: `OPEN → PENDING → GRANTED | DENIED`; from `GRANTED`: `SUSPENDED` or `REVOKED`; from `SUSPENDED`: `GRANTED` or `REVOKED`. `DENIED` and `REVOKED` are terminal. `SUSPENDED` and `REVOKED` require a `reason`. Expiry is `valid_until` on `GRANTED`, not a state.

A resolver (payment, delivery, anchor) informs your decision; in v1 it never signs lifecycle statuses itself. The reference `@proofmeta/resolver-free` returns `ok` and a receipt; you sign.

### 5. Serve status

Store the chain per `request_id` and answer `GET {request_endpoint}/{request_id}` with the last envelope, or the full array for `?full=true`. Consumers may re-verify the whole chain at any time, so never rewrite history: a new decision is a new envelope appended to the chain.

Reserve `request_id` after validation and before you sign, so a concurrent duplicate gets `409` and exactly one chain exists per ID. The reference keeps this in memory; a real deployment persists chains and reservations.

## What you must not do

- Accept a parsed object instead of bytes for anything that came over the network; parsed values cannot prove encoding or duplicate-key freedom.
- Sign a status for a chain whose root `provider_id` is not your DID.
- Let a resolver's own signature stand in for yours.
- Change `terms_url` content without re-issuing the manifest with the new `terms_hash`.

## Run the reference

```sh
node examples/provider/server.mjs                       # http://127.0.0.1:4100
PROVIDER_ORIGIN=http://127.0.0.1:4100 node examples/consumer/client.mjs
npx @proofmeta/cli fetch http://127.0.0.1:4100
```

From a source checkout after the install in [INSTALL.md](./INSTALL.md); `npm run e2e` runs both sides. Node 18 needs `NODE_OPTIONS=--experimental-global-webcrypto`.

Frameworks: the SDK has no HTTP dependency. Anything that gives you the raw request bytes (Express `raw()`, Hono `c.req.arrayBuffer()`, a Worker `request.arrayBuffer()`) works the same way. A higher-level provider handler package is planned in a separate repository; it will wrap exactly the steps above.
