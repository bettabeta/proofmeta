// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * ed25519 keypair helpers.
 *
 * We use @noble/ed25519's *async* API (getPublicKeyAsync / signAsync /
 * verifyAsync), which uses WebCrypto under the hood — no sha512 injection
 * required. Sync variants would need `ed.etc.sha512Sync` set; we deliberately
 * don't, to keep the core dependency surface minimal.
 */

import * as ed25519 from "@noble/ed25519";
import { encodeDidKey } from "./did-key.js";
import type { Did } from "./types.js";

export interface KeyPair {
  /** 32-byte ed25519 seed (private key). */
  privateKey: Uint8Array;
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** did:key DID derived from publicKey. */
  did: Did;
}

/** Generate a fresh ed25519 keypair and its did:key DID. */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    did: encodeDidKey(publicKey),
  };
}

/** Derive a KeyPair from an existing 32-byte ed25519 seed. */
export async function keyPairFromPrivate(
  privateKey: Uint8Array,
): Promise<KeyPair> {
  if (privateKey.length !== 32) {
    throw new Error(
      `ed25519 private key must be 32 bytes (got ${privateKey.length})`,
    );
  }
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    did: encodeDidKey(publicKey),
  };
}
