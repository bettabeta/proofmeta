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

import { generateKeyPair, requestLicense } from "@proofmeta/sdk-ts";

const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN ?? "http://127.0.0.1:4100";
const ITEM_ID = process.env.ITEM_ID ?? "cost-optimizer-skill@0.1";
const LICENSE_TYPE = process.env.LICENSE_TYPE ?? "free-attribution";

const manifestUrl = `${PROVIDER_ORIGIN}/.well-known/proofmeta.json`;
const consumerKey = await generateKeyPair();
const result = await requestLicense({
  manifestUrl,
  itemId: ITEM_ID,
  licenseType: LICENSE_TYPE,
  keyPair: consumerKey,
  pollTimeoutMs: 30_000,
});

if (!result.ok) fail(result.reason);

console.log(`[consumer] received ${result.chain.length}-envelope chain`);
console.log(`[consumer] chain OK — final status=${result.status}`);
console.log("[consumer] full Tier-1 flow completed OK");

function fail(msg) {
  console.error(`[consumer] FAIL: ${msg}`);
  process.exit(1);
}
