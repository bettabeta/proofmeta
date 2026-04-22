# @proofmeta/resolver-free

Reference "free" resolver for the [ProofMeta Protocol](https://github.com/bettabeta/proofmeta). No-op: confirms instantly, carries no external dependencies. Use it for Tier-1 flows, demos, and integration tests where no real payment or delivery is needed.

## Install

```
npm install @proofmeta/resolver-free
```

## Use

```js
import { createFreeResolver } from "@proofmeta/resolver-free";

const free = createFreeResolver({ id: "none" });

// 1. Advertise it in your Manifest
manifest.resolvers = [free.descriptor];
// → { role: "payment", id: "none" }

// 2. Invoke it when handling an OPEN license request
const result = await free.process({ request, licenseType });
// → { ok: true, receipt: { resolver: "free:none", confirmed_at: "..." } }
```

## Resolver interface

The programming interface below is **not** part of the ProofMeta protocol on the wire — it's the shape the reference Provider (`examples/provider/server.mjs`) expects from a resolver module. Other Providers are free to invent their own calling convention; what matters on the wire is the `{ role, id }` entry in the Manifest and the resulting `status.update` envelopes.

```ts
{
  descriptor: { role: "payment" | "delivery" | "anchor" | string, id: string },
  process(ctx: { request, licenseType }): Promise<
    { ok: true,  receipt?: Record<string, unknown> } |
    { ok: false, reason:  string }
  >
}
```

## License

Apache-2.0. See [LICENSE](https://github.com/bettabeta/proofmeta/blob/main/LICENSE).
