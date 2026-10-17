// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser bundle entry for the site tools (/generate and /verify).
 * Re-exports the SDK surface those pages need. Bundled by
 * scripts/build-site-tools.mjs into site/tools/proofmeta-tools.min.js.
 * Everything runs client-side; no key material ever leaves the browser.
 */

export {
  generateKeyPair,
  keyPairFromPrivate,
} from "../packages/sdk-ts/dist/keys.js";
export {
  createEnvelope,
  verifyEnvelope,
} from "../packages/sdk-ts/dist/envelope.js";
export { hashPayload } from "../packages/sdk-ts/dist/hash.js";
export { jcs } from "../packages/sdk-ts/dist/jcs.js";
export { validateManifestScope } from "../packages/sdk-ts/dist/scope.js";
export {
  acceptProtocolInput,
  parseProtocolJson,
  JsonIngressError,
} from "../packages/sdk-ts/dist/acceptance.js";

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export { bytesToHex, hexToBytes };

/** sha256 of raw bytes, in the protocol's "sha256:<hex>" notation. */
export function sha256Ref(bytes) {
  return "sha256:" + bytesToHex(sha256(bytes));
}
