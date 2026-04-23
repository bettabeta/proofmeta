// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Reference ProofMeta Consumer Agent.
 *
 * Runs the full Tier-1 flow:
 *   1. Fetch the Manifest envelope from the Provider's Well-Known URL.
 *   2. Cryptographically verify the Manifest.
 *   3. Pick an item + license_type from the inline catalog (or the
 *      `catalog_endpoint` when the Provider uses one).
 *   4. Sign an OPEN license.request envelope, POST it to request_endpoint.
 *   5. Verify the returned chain end-to-end.
 *
 * Exit code 0 on success, non-zero on any failure.
 */

import { randomBytes } from "node:crypto";
import {
  generateKeyPair,
  createEnvelope,
  verifyEnvelope,
  verifyChain,
} from "@proofmeta/sdk-ts";

const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN ?? "http://127.0.0.1:4100";

// ── 1. Discovery ──────────────────────────────────────────────────────────

const manifestUrl = `${PROVIDER_ORIGIN}/.well-known/proofmeta.json`;
const manifestRes = await fetch(manifestUrl);
if (!manifestRes.ok) fail(`manifest fetch failed: ${manifestRes.status}`);
const manifestEnvelope = await manifestRes.json();

const mv = await verifyEnvelope(manifestEnvelope);
if (!mv.ok) fail(`manifest verification failed: ${mv.reason}`);
console.log(`[consumer] manifest verified — provider DID ${manifestEnvelope.payload.provider.id}`);

const manifest = manifestEnvelope.payload;

// ── 2. Pick an item + license type ────────────────────────────────────────

const items = manifest.items ?? [];
if (items.length === 0) {
  // If the manifest exposed a catalog_endpoint instead, we'd GET it here.
  fail("manifest has no inline items; catalog_endpoint branch not exercised in this demo");
}
const item = items[0];
const licenseTypeId = item.available_licenses[0];
const licenseType = manifest.license_types.find((lt) => lt.id === licenseTypeId);
if (!licenseType) fail(`manifest missing license_type "${licenseTypeId}"`);
console.log(`[consumer] selected item=${item.item_id} license_type=${licenseType.id}`);
if (item.content_hash) {
  console.log(`[consumer] item declares content_hash=${item.content_hash} — a real Consumer would verify delivered bytes against this after GRANTED`);
}

// ── 3. Sign OPEN envelope ─────────────────────────────────────────────────

const consumerKey = await generateKeyPair();
const requestId = uuidv7();

const openEnvelope = await createEnvelope({
  payload: {
    type: "license.request",
    request_id: requestId,
    consumer: {
      id: consumerKey.did,
      callback_url: "https://consumer.example/proofmeta/callback",
    },
    provider_id: manifest.provider.id,
    item_id: item.item_id,
    license_type: licenseType.id,
    terms_hash: licenseType.terms_hash,
    resolver_preferences: [{ role: "payment", id: "none" }],
    status: "OPEN",
  },
  author: consumerKey.did,
  privateKey: consumerKey.privateKey,
});

// ── 4. POST request ───────────────────────────────────────────────────────

const requestEndpoint = manifest.request_endpoint;
const postRes = await fetch(requestEndpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(openEnvelope),
});
if (!postRes.ok) {
  const txt = await postRes.text();
  fail(`request POST failed: ${postRes.status} ${txt}`);
}
const { chain } = await postRes.json();
if (!Array.isArray(chain) || chain.length < 2) fail("server returned unexpected chain shape");
console.log(`[consumer] received ${chain.length}-envelope chain`);

// ── 5. Verify the chain end-to-end ────────────────────────────────────────

const cv = await verifyChain(chain);
if (!cv.ok) fail(`chain verification failed: ${cv.reason}`);

const final = chain[chain.length - 1];
console.log(`[consumer] chain OK — final status=${final.payload.status}`);
if (final.payload.status !== "GRANTED") fail(`expected GRANTED, got ${final.payload.status}`);

// ── 6. Sanity: pull status via GET ────────────────────────────────────────

const getUrl = `${requestEndpoint}/${requestId}`;
const getRes = await fetch(getUrl);
if (!getRes.ok) fail(`GET status failed: ${getRes.status}`);
const latest = await getRes.json();
const lv = await verifyEnvelope(latest);
if (!lv.ok) fail(`GET status envelope invalid: ${lv.reason}`);
if (latest.payload.status !== "GRANTED" || latest.payload.request_id !== requestId) {
  fail("GET status envelope did not match expectations");
}

console.log("[consumer] full Tier-1 flow completed OK");

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal UUID v7 per draft-04. 48-bit unix-ms timestamp + random tail. */
function uuidv7() {
  const ts = BigInt(Date.now());
  const tsHex = ts.toString(16).padStart(12, "0"); // 48 bits
  const rnd = randomBytes(10); // 80 random bits (we replace 2 nibbles for version/variant)
  // Place version (0x7) in the 13th nibble and variant (0b10xx) in the 17th.
  rnd[0] = (rnd[0] & 0x0f) | 0x70; // version 7
  rnd[2] = (rnd[2] & 0x3f) | 0x80; // variant 10xx
  const hex =
    tsHex.slice(0, 8) +
    "-" +
    tsHex.slice(8, 12) +
    "-" +
    rnd.subarray(0, 2).toString("hex") +
    "-" +
    rnd.subarray(2, 4).toString("hex") +
    "-" +
    rnd.subarray(4, 10).toString("hex");
  return hex;
}

function fail(msg) {
  console.error(`[consumer] FAIL: ${msg}`);
  process.exit(1);
}
