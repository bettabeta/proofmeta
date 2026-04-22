// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * did:key encoding/decoding for ed25519 keys. See §3.1.2.
 *
 *   did:key:z<base58btc( multicodec_prefix || pubkey_bytes )>
 *
 * The multicodec prefix for ed25519-pub is two bytes: 0xed 0x01.
 * Reference: https://w3c-ccg.github.io/did-method-key/
 */

import { base58 } from "@scure/base";
import type { Did } from "./types.js";

/** Multicodec prefix for ed25519 public keys (0xed 0x01 as varint). */
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

export const DID_KEY_PREFIX = "did:key:";

/** Encode a raw 32-byte ed25519 public key as a did:key DID. */
export function encodeDidKey(publicKey: Uint8Array): Did {
  if (publicKey.length !== 32) {
    throw new Error(
      `ed25519 public key must be 32 bytes (got ${publicKey.length})`,
    );
  }
  const payload = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length,
  );
  payload.set(ED25519_MULTICODEC_PREFIX, 0);
  payload.set(publicKey, ED25519_MULTICODEC_PREFIX.length);
  return `did:key:z${base58.encode(payload)}` as Did;
}

/**
 * Decode a did:key DID to its raw ed25519 public key.
 * Throws if the DID is malformed, uses a non-ed25519 multicodec, or has
 * an unexpected key length.
 */
export function decodeDidKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`Not a did:key DID: ${did}`);
  }
  const rest = did.slice(DID_KEY_PREFIX.length);
  if (!rest.startsWith("z")) {
    throw new Error(
      `did:key must use base58btc multibase ('z' prefix): ${did}`,
    );
  }
  const decoded = base58.decode(rest.slice(1));
  if (decoded.length < 2) {
    throw new Error(`did:key payload too short: ${did}`);
  }
  if (
    decoded[0] !== ED25519_MULTICODEC_PREFIX[0] ||
    decoded[1] !== ED25519_MULTICODEC_PREFIX[1]
  ) {
    throw new Error(
      `did:key does not use ed25519 multicodec (0xed 0x01): ${did}`,
    );
  }
  const key = decoded.slice(2);
  if (key.length !== 32) {
    throw new Error(
      `ed25519 public key in did:key must be 32 bytes (got ${key.length}): ${did}`,
    );
  }
  return key;
}

/** Returns true iff the DID is a syntactically-valid did:key with ed25519. */
export function isDidKeyEd25519(did: string): boolean {
  try {
    decodeDidKey(did);
    return true;
  } catch {
    return false;
  }
}
