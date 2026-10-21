// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Key file format shared with the browser generator's key backup.
 *
 * Plain:     { proofmeta_key: 1, did, private_key_hex, created, warning }
 * Encrypted: { proofmeta_key: 1, did, created, kdf: { name: "PBKDF2", hash: "SHA-256",
 *              iterations, salt }, cipher: { name: "AES-GCM", iv }, ciphertext }
 *
 * Hex everywhere. AES-GCM ciphertext carries the 16-byte tag at the end, which
 * is what WebCrypto produces and expects, so a file written here opens in the
 * browser and vice versa. Files written by older generators (no `proofmeta_key`
 * field) are accepted when they carry `private_key_hex`.
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "node:crypto";
import { keyPairFromPrivate } from "@proofmeta/sdk-ts";

export const KDF_ITERATIONS = 600000;
const HEX = /^[0-9a-f]+$/;

const toHex = (u8) => Buffer.from(u8).toString("hex");
const fromHex = (hex) => {
  if (typeof hex !== "string" || hex.length % 2 || !HEX.test(hex)) throw new Error("invalid hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
};

export function plainKeyFile(keyPair) {
  return {
    proofmeta_key: 1,
    warning: "PRIVATE KEY — keep secret. Anyone with this file can sign as your DID.",
    did: keyPair.did,
    private_key_hex: toHex(keyPair.privateKey),
    created: new Date().toISOString(),
  };
}

export function encryptedKeyFile(keyPair, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(keyPair.privateKey), cipher.final(), cipher.getAuthTag()]);
  return {
    proofmeta_key: 1,
    did: keyPair.did,
    created: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toHex(salt) },
    cipher: { name: "AES-GCM", iv: toHex(iv) },
    ciphertext: toHex(body),
  };
}

export function isEncryptedKeyFile(value) {
  return !!value && typeof value === "object" && typeof value.ciphertext === "string";
}

/**
 * Resolve a key file to a KeyPair. `getPassphrase` is only called for
 * encrypted files. Throws on malformed input or a DID that does not match
 * the recovered private key.
 */
export async function keyPairFromKeyFile(value, getPassphrase) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("key file must be a JSON object");
  let privateKey;
  if (isEncryptedKeyFile(value)) {
    const { kdf, cipher } = value;
    if (!kdf || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || !Number.isInteger(kdf.iterations) || kdf.iterations < 1) throw new Error("unsupported kdf");
    if (!cipher || cipher.name !== "AES-GCM") throw new Error("unsupported cipher");
    const passphrase = await getPassphrase();
    if (typeof passphrase !== "string" || !passphrase.length) throw new Error("passphrase required");
    const key = pbkdf2Sync(passphrase, fromHex(kdf.salt), kdf.iterations, 32, "sha256");
    const body = fromHex(value.ciphertext);
    if (body.length < 17) throw new Error("ciphertext too short");
    const decipher = createDecipheriv("aes-256-gcm", key, fromHex(cipher.iv));
    decipher.setAuthTag(body.subarray(body.length - 16));
    try {
      privateKey = new Uint8Array(Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]));
    } catch {
      throw new Error("wrong passphrase or corrupted key file");
    }
  } else if (typeof value.private_key_hex === "string") {
    privateKey = fromHex(value.private_key_hex.toLowerCase());
  } else {
    throw new Error("key file has neither private_key_hex nor ciphertext");
  }
  const keyPair = await keyPairFromPrivate(privateKey);
  if (typeof value.did === "string" && value.did !== keyPair.did) throw new Error("key file did does not match the private key");
  return keyPair;
}
