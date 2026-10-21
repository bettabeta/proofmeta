// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser side of the key-file format in packages/cli/src/keyfile.mjs.
 * Plain: { proofmeta_key: 1, did, private_key_hex, created, warning }.
 * Encrypted: PBKDF2-SHA256 (600000 iterations, 16-byte salt) → AES-256-GCM
 * (12-byte IV, 16-byte tag appended to the ciphertext), all hex. A file
 * written here opens with `proofmeta sign --key` and vice versa.
 */
(() => {
  "use strict";
  const KDF_ITERATIONS = 600000;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;

  const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  function fromHex(hex) {
    if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) throw new Error("invalid hex");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  async function deriveKey(passphrase, salt, iterations) {
    const material = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  function plain(keyPair) {
    return {
      proofmeta_key: 1,
      warning: "PRIVATE KEY — keep secret. Anyone with this file can sign as your DID.",
      did: keyPair.did,
      private_key_hex: toHex(keyPair.privateKey),
      created: new Date().toISOString(),
    };
  }

  async function encrypt(keyPair, passphrase) {
    if (!subtle) throw new Error("WebCrypto is not available (https or localhost required)");
    if (typeof passphrase !== "string" || passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
    const body = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, keyPair.privateKey));
    return {
      proofmeta_key: 1,
      did: keyPair.did,
      created: new Date().toISOString(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toHex(salt) },
      cipher: { name: "AES-GCM", iv: toHex(iv) },
      ciphertext: toHex(body),
    };
  }

  const isEncrypted = (value) => !!value && typeof value === "object" && typeof value.ciphertext === "string";

  /** Returns the 32-byte private key. `getPassphrase` is called only for encrypted files. */
  async function privateKeyFrom(value, getPassphrase) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("key file must be a JSON object");
    if (isEncrypted(value)) {
      if (!subtle) throw new Error("WebCrypto is not available (https or localhost required)");
      const { kdf, cipher } = value;
      if (!kdf || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || !Number.isInteger(kdf.iterations) || kdf.iterations < 1) throw new Error("unsupported kdf");
      if (!cipher || cipher.name !== "AES-GCM") throw new Error("unsupported cipher");
      const passphrase = await getPassphrase();
      if (typeof passphrase !== "string" || !passphrase.length) throw new Error("passphrase required");
      const key = await deriveKey(passphrase, fromHex(kdf.salt), kdf.iterations);
      try {
        const plainBytes = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: fromHex(cipher.iv) }, key, fromHex(value.ciphertext)));
        if (plainBytes.length !== 32) throw new Error();
        return plainBytes;
      } catch {
        throw new Error("wrong passphrase or corrupted key file");
      }
    }
    if (typeof value.private_key_hex === "string") {
      const bytes = fromHex(value.private_key_hex.toLowerCase());
      if (bytes.length !== 32) throw new Error("private key must be 32 bytes");
      return bytes;
    }
    throw new Error("key file has neither private_key_hex nor ciphertext");
  }

  globalThis.ProofMetaKeyFile = { KDF_ITERATIONS, plain, encrypt, privateKeyFrom, isEncrypted, toHex, fromHex };
})();
