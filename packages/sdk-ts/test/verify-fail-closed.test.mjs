// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import { createEnvelope, generateKeyPair, verifyChain, verifyEnvelope } from "../dist/index.js";

async function signed(timestamp = "2026-01-01T00:00:00Z") {
  const kp = await generateKeyPair();
  return createEnvelope({
    payload: { type: "manifest", provider: { id: kp.did } },
    author: kp.did,
    privateKey: kp.privateKey,
    timestamp,
  });
}

async function assertRejected(envelope) {
  const single = await verifyEnvelope(envelope);
  assert.equal(single.ok, false);
  assert.equal(typeof single.reason, "string");
  assert.ok(single.reason.length > 0);

  const chain = await verifyChain([envelope]);
  assert.equal(chain.ok, false);
  assert.equal(typeof chain.reason, "string");
}

test("Z, z, and +00:00 timestamps still verify", async () => {
  for (const timestamp of [
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00z",
    "2026-01-01T00:00:00+00:00",
    "2026-01-01T00:00:00.123Z",
  ]) {
    const result = await verifyEnvelope(await signed(timestamp));
    assert.equal(result.ok, true, timestamp);
  }
});

test("timestamp with a nonzero offset is rejected without throwing", async () => {
  await assertRejected(await signed("2026-01-01T00:00:00+02:00"));
});

test("uppercase signature hex is rejected without throwing", async () => {
  const env = await signed();
  const hex = env.signature.slice("ed25519:".length);
  assert.match(hex, /[a-f]/);
  await assertRejected({ ...env, signature: `ed25519:${hex.toUpperCase()}` });
});

test("short signature is rejected without throwing", async () => {
  const env = await signed();
  await assertRejected({ ...env, signature: "ed25519:abcd" });
});

test("undefined signature is rejected without throwing", async () => {
  const env = await signed();
  await assertRejected({ ...env, signature: undefined });
});

test("a failed resolveAuthor is not reported as a malformed envelope", async () => {
  const env = await signed();
  const author = "did:example:not-a-key";
  const envelope = { ...env, author };
  const thrown = await verifyEnvelope(envelope, {
    resolveAuthor() {
      throw new Error("secret token");
    },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, `cannot resolve author DID: ${author}`);
  assert.equal(thrown.reason.includes("secret"), false);

  const short = await verifyEnvelope(envelope, {
    resolveAuthor: () => new Uint8Array(16),
  });
  assert.equal(short.ok, false);
  assert.equal(short.reason, `cannot resolve author DID: ${author}`);

  const mismatched = await verifyEnvelope(envelope, {
    resolveAuthor: () => new Uint8Array(32),
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, "invalid ed25519 signature");
});

test("uppercase payload_hash is rejected without throwing", async () => {
  const env = await signed();
  const hex = env.payload_hash.slice("sha256:".length);
  assert.match(hex, /[a-f]/);
  await assertRejected({ ...env, payload_hash: `sha256:${hex.toUpperCase()}` });
});
