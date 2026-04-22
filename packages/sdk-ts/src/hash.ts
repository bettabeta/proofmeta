// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Payload hashing for Signed Envelopes. See §3.1.1.
 *
 *   payload_hash = "sha256:" + hex( sha256( jcs_serialize(payload) ) )
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { jcs } from "./jcs.js";
import type { Sha256Ref } from "./types.js";

/** Compute the canonical payload hash of any JSON-serializable value. */
export function hashPayload(payload: unknown): Sha256Ref {
  const canonical = jcs(payload);
  const bytes = new TextEncoder().encode(canonical);
  return `sha256:${bytesToHex(sha256(bytes))}` as Sha256Ref;
}

/** Constant-time-ish string equality for hash comparison. */
export function hashesEqual(a: Sha256Ref, b: Sha256Ref): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
