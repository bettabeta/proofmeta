// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import * as ed25519 from "@noble/ed25519";
import { createEnvelope, generateKeyPair, hashPayload } from "@proofmeta/sdk-ts";
import { discoverManifest, verifyManifest } from "../dist/index.js";
import { jsonBytes, manifestPayload, sendBytes, serve, signedManifest, stubFetch } from "./helpers.mjs";

const LOOPBACK = { allowHttpLoopback: true };

async function withServer(routes, fn) {
  const srv = await serve(routes);
  try {
    await fn(srv.base);
  } finally {
    await srv.close();
  }
}

function assertRejected(r, code) {
  assert.equal(r.accepted, false);
  assert.equal("manifest" in r, false, "rejected result must not carry a manifest");
  if (code) {
    const codes = r.transport.ok ? r.report.errors.map((e) => e.code) : [r.transport.code];
    assert.ok(codes.includes(code), `expected ${code}, got ${JSON.stringify(codes)}`);
  }
}

test("accepts a valid SDK-signed manifest and returns it", async () => {
  const { envelope } = await signedManifest();
  await withServer({ "/m.json": sendBytes(jsonBytes(envelope)) }, async (base) => {
    const r = await verifyManifest(`${base}/m.json`, LOOPBACK);
    assert.equal(r.accepted, true);
    assert.deepEqual(JSON.parse(JSON.stringify(r.manifest)), envelope);
    assert.equal(r.report.accepted, true);
    assert.equal(r.report.operation, "manifest");
    assert.equal(r.report.guarantees.operationalAuthorization, false);
    assert.equal("snapshot" in r.report, false);
    assert.equal(r.transport.status, 200);
  });
});

test("rejects tampered payload (HASH_MISMATCH)", async () => {
  const { envelope } = await signedManifest();
  envelope.payload.request_endpoint = "https://attacker.example/request";
  await withServer({ "/m.json": sendBytes(jsonBytes(envelope)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "HASH_MISMATCH");
  });
});

test("rejects a signature from a different key (SIGNATURE_INVALID)", async () => {
  const { envelope } = await signedManifest();
  const other = await signedManifest();
  envelope.signature = other.envelope.signature;
  await withServer({ "/m.json": sendBytes(jsonBytes(envelope)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "SIGNATURE_INVALID");
  });
});

test("rejects a legacy payload_hash-only signature (pre-D16, as produced by sdk-ts 0.2.0)", async () => {
  const kp = await generateKeyPair();
  const payload = manifestPayload(kp.did);
  const payload_hash = hashPayload(payload);
  const sig = await ed25519.signAsync(new TextEncoder().encode(payload_hash), kp.privateKey);
  const legacy = {
    proofmeta: "1.0",
    payload,
    payload_hash,
    author: kp.did,
    signature: "ed25519:" + Buffer.from(sig).toString("hex"),
    timestamp: "2026-10-17T00:00:00Z",
  };
  await withServer({ "/m.json": sendBytes(jsonBytes(legacy)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "SIGNATURE_INVALID");
  });
});

test("rejects author != provider.id (AUTHORITY_MISMATCH)", async () => {
  const other = await generateKeyPair();
  const { envelope } = await signedManifest((did) => ({ ...manifestPayload(did), provider: { id: other.did } }));
  await withServer({ "/m.json": sendBytes(jsonBytes(envelope)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "AUTHORITY_MISMATCH");
  });
});

test("rejects a valid envelope that is not a manifest", async () => {
  const consumer = await generateKeyPair();
  const provider = await generateKeyPair();
  const open = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
      consumer: { id: consumer.did },
      provider_id: provider.did,
      item_id: "item-001",
      license_type: "standard",
      terms_hash: "sha256:" + "0".repeat(64),
      status: "OPEN",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  await withServer({ "/m.json": sendBytes(jsonBytes(open)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "MODE_INVALID");
  });
});

test("rejects a leading UTF-8 BOM at transport ingress", async () => {
  const { envelope } = await signedManifest();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), jsonBytes(envelope)]);
  await withServer({ "/m.json": sendBytes(bytes) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "BOM_UNSUPPORTED");
  });
});

test("rejects duplicate JSON keys", async () => {
  const { envelope } = await signedManifest();
  const raw = JSON.stringify(envelope).replace('"proofmeta":"1.0"', '"proofmeta":"1.0","proofmeta":"1.0"');
  await withServer({ "/m.json": sendBytes(Buffer.from(raw)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "JSON_DUPLICATE_KEY");
  });
});

test("rejects non-JSON bodies", async () => {
  await withServer(
    { "/m.json": sendBytes(Buffer.from("<html>hi</html>"), { "content-type": "text/html" }) },
    async (base) => {
      assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "JSON_SYNTAX");
    },
  );
});

test("rejects non-200 responses", async () => {
  await withServer({}, async (base) => {
    const r = await verifyManifest(`${base}/missing.json`, LOOPBACK);
    assertRejected(r, "HTTP_STATUS");
    assert.equal(r.transport.status, 404);
    assert.equal(r.report, undefined);
  });
});

test("does not follow redirects and reports the location", async () => {
  const { envelope } = await signedManifest();
  await withServer(
    {
      "/old.json": (_req, res) => res.writeHead(307, { location: "/m.json" }).end(),
      "/m.json": sendBytes(jsonBytes(envelope)),
    },
    async (base) => {
      const r = await verifyManifest(`${base}/old.json`, LOOPBACK);
      assertRejected(r, "REDIRECT_NOT_FOLLOWED");
      assert.equal(r.transport.status, 307);
      assert.equal(r.transport.location, "/m.json");
    },
  );
});

test("rejects bodies above maxBytes (declared and streamed)", async () => {
  const big = Buffer.alloc(2048, 0x20);
  await withServer(
    {
      "/declared.json": sendBytes(big),
      "/chunked.json": (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write(big);
        res.end(big);
      },
    },
    async (base) => {
      assertRejected(await verifyManifest(`${base}/declared.json`, { ...LOOPBACK, maxBytes: 1024 }), "BODY_TOO_LARGE");
      assertRejected(await verifyManifest(`${base}/chunked.json`, { ...LOOPBACK, maxBytes: 3000 }), "BODY_TOO_LARGE");
    },
  );
});

test("times out on a stalled response", async () => {
  await withServer(
    {
      "/slow.json": (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write("{");
        setTimeout(() => res.end("}"), 1000).unref();
      },
    },
    async (base) => {
      assertRejected(await verifyManifest(`${base}/slow.json`, { ...LOOPBACK, timeoutMs: 100 }), "TIMEOUT");
    },
  );
});

test("reports network failures as FETCH_FAILED", async () => {
  const srv = await serve({});
  const base = srv.base;
  await srv.close();
  assertRejected(await verifyManifest(`${base}/m.json`, LOOPBACK), "FETCH_FAILED");
});

test("plain http is rejected unless loopback is explicitly allowed", async () => {
  const { envelope } = await signedManifest();
  await withServer({ "/m.json": sendBytes(jsonBytes(envelope)) }, async (base) => {
    assertRejected(await verifyManifest(`${base}/m.json`), "SCHEME_UNSUPPORTED");
  });
  assertRejected(await verifyManifest("http://provider.example/m.json", LOOPBACK), "SCHEME_UNSUPPORTED");
});

test("fetch exceptions never produce an accepted result", async () => {
  const r = await verifyManifest("https://provider.example/m.json", {
    fetch: async () => {
      throw new TypeError("boom");
    },
  });
  assertRejected(r, "FETCH_FAILED");
});

test("discover_manifest fetches only the well-known URL and verifies it", async () => {
  const { envelope } = await signedManifest();
  const fetch = stubFetch({
    "https://provider.example/.well-known/proofmeta.json": () =>
      new Response(jsonBytes(envelope), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const r = await discoverManifest("Provider.Example", { fetch });
  assert.equal(r.accepted, true);
  assert.equal(r.url, "https://provider.example/.well-known/proofmeta.json");
  assert.deepEqual(JSON.parse(JSON.stringify(r.manifest)), envelope);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.redirect, "manual");
  assert.equal(fetch.calls[0].init.method, "GET");
});

test("discover_manifest rejects an invalid manifest at the well-known URL", async () => {
  const { envelope } = await signedManifest();
  envelope.payload.provider.name = "tampered";
  const fetch = stubFetch({
    "https://provider.example/.well-known/proofmeta.json": () => new Response(jsonBytes(envelope), { status: 200 }),
  });
  assertRejected(await discoverManifest("provider.example", { fetch }), "HASH_MISMATCH");
});

test("discover_manifest rejects malformed domains without fetching", async () => {
  const fetch = stubFetch({});
  for (const d of [
    "",
    " provider.example",
    "provider.example ",
    "https://provider.example",
    "provider.example/path",
    "provider.example:8443",
    "user@provider.example",
    "provider.example?x=1",
    "provider.example#x",
    "localhost",
    "127.0.0.1",
    "[::1]",
    "-bad.example",
    "bad-.example",
    "provider.example.",
    "a..example",
    "x".repeat(64) + ".example",
  ]) {
    const r = await discoverManifest(d, { fetch });
    assertRejected(r, "DOMAIN_INVALID");
  }
  assert.equal(fetch.calls.length, 0);
});
