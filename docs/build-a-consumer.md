# Build a Consumer agent

For developers whose agent needs to know, before it acts, what a Provider allows and to obtain a signed grant when one is needed. Normative text: `SPEC.md` §3.7, §3.6, §3.4, §6. Working reference: [`examples/consumer/client.mjs`](../examples/consumer/client.mjs).

## Quick look without code

```sh
npx @proofmeta/cli fetch example.com
```

fetches `https://example.com/.well-known/proofmeta.json`, runs the same acceptance a Consumer runs, and prints the signer, the endpoints and every license type with its scope tags. Exit 0 means accepted. This is the whole read-only side of the protocol in one command.

## One call

```js
import { generateKeyPair, requestLicense } from "@proofmeta/sdk-ts";

const keyPair = await generateKeyPair(); // or your agent's persistent identity
const result = await requestLicense({
  manifestUrl: "https://example.com/.well-known/proofmeta.json",
  itemId: "item-001",
  licenseType: "free-attribution",
  keyPair,
  pollTimeoutMs: 30_000,
});
if (!result.ok) throw new Error(result.reason);
result.chain; // [OPEN, …, GRANTED], every envelope verified
```

`requestLicense` fetches and accepts the manifest, checks that the inline item offers the license type, signs and POSTs an `OPEN`, accepts the returned chain with `consumer-response` evidence, polls `GET {request_endpoint}/{request_id}` for the latest envelope until a terminal status, and returns only a chain that passed acceptance and ends in `GRANTED`. Protocol and network failures come back as `{ ok: false, reason }`; nothing throws. It covers manifests with inline `items`; a `catalog_endpoint` (§3.8), a `callback_url`, `resolver_preferences` or your own transport need the steps below.

## The same flow step by step

Use this when you need a catalog query, your own transport, or a reason code from the acceptance report.

```js
import {
  generateKeyPair,
  createEnvelope,
  isCurrentlyValid,
} from "@proofmeta/sdk-ts";
import {
  acceptProtocolInput,
  parseProtocolJson,
} from "@proofmeta/sdk-ts/acceptance";
```

### 1. Discover and verify the manifest

```js
const res = await fetch(`${origin}/.well-known/proofmeta.json`);
const mv = await acceptProtocolInput(
  { kind: "bytes", bytes: new Uint8Array(await res.arrayBuffer()) },
  { operation: "manifest", purpose: "protocol-conformance" },
);
if (!mv.accepted) throw new Error(mv.errors[0].code);
const manifest = mv.snapshot; // frozen, detached
```

Always hand the SDK the raw bytes. `accepted: true` means ingress, schema, hash, signature, `author == provider.id` and scope all passed. The manifest is self-authenticating; where you got the URL from does not matter.

### 2. Decide whether the terms fit

`manifest.payload.license_types[].scope` holds core tags ([scope-vocabulary.md](./scope-vocabulary.md)) and optional URLs. Filter on the core tags; for URLs you do not understand, ignore, reject or escalate to a human. Absence of a tag means the protocol says nothing; `terms_url` is authoritative there. If the terms say no request is needed, you can stop here with a verified record of what you relied on.

### 3. Request a license

```js
const key = await generateKeyPair(); // or a persistent identity for your agent
const open = await createEnvelope({
  payload: {
    type: "license.request",
    request_id: crypto.randomUUID(), // the reference uses UUID v7
    consumer: {
      id: key.did,
      callback_url: "https://agent.example/proofmeta/callback",
    },
    provider_id: manifest.payload.provider.id,
    item_id: item.item_id,
    license_type: licenseType.id,
    terms_hash: licenseType.terms_hash,
    resolver_preferences: [{ role: "payment", id: "none" }],
    status: "OPEN",
  },
  author: key.did,
  privateKey: key.privateKey,
});
const post = await fetch(manifest.payload.request_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(open),
});
```

`terms_hash` in the request is the hash you saw in the manifest; the Provider rejects a stale one, which protects you from silently changed terms.

### 4. Accept the answer with evidence

The reference Provider answers `{ "chain": [OPEN, PENDING, GRANTED] }`. Parse the wrapper strictly, then let the SDK check the chain against what you sent and what you read:

```js
const wrapper = parseProtocolJson(new Uint8Array(await post.arrayBuffer()));
const cv = await acceptProtocolInput(
  { kind: "value", value: wrapper.chain },
  {
    operation: "license-chain",
    purpose: "consumer-response",
    sentOpen: open,
    expectedProvider: manifest.payload.provider.id,
    manifest,
    item,
    licenseType: licenseType.id,
    termsHash: licenseType.terms_hash,
  },
);
if (!cv.accepted) throw new Error(cv.errors[0].code);
const chain = cv.snapshot;
```

With `consumer-response` the SDK additionally checks that the chain's root is byte-for-byte your OPEN, every status is signed by the Provider named in the manifest (D18), `in_reply_to` links are intact, transitions are legal, and item, license type and terms hash agree across request, manifest and chain. All of it is required; a missing piece of evidence is `CONTEXT_REQUIRED`, not a pass.

### 5. Act, and re-check later

`chain.at(-1).payload.status === "GRANTED"` plus `isCurrentlyValid(chain)` (which honours `valid_until`) is your go signal. If the item declared `content_hash`, compare delivered bytes against it. Poll `GET {request_endpoint}/{request_id}` (latest) or `?full=true` (whole chain) to see suspensions or revocations; a new head must extend the chain you accepted, never replace it.

## What acceptance does not tell you

Nothing about the terms text behind `terms_url`, delivery, payment, anchors, trusted time or legal effect. The report says so explicitly in `guarantees`. Those are resolver and application concerns.

## Running the reference

```sh
node examples/provider/server.mjs
PROVIDER_ORIGIN=http://127.0.0.1:4100 node examples/consumer/client.mjs
```

From a source checkout after [INSTALL.md](./INSTALL.md). The reference consumer is `requestLicense` plus a few lines of logging; the step-by-step section above is what that function does internally.
