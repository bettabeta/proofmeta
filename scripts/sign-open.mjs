// One-shot helper: mint a consumer keypair and print a signed OPEN envelope to stdout.
// Used by the README battle-test. Not shipped as part of the protocol.

import { generateKeyPair, createEnvelope } from "@proofmeta/sdk-ts";

const [, , providerDid, itemId, licenseType, termsHash] = process.argv;
if (!providerDid) {
  console.error("usage: sign-open.mjs <providerDid> <itemId> <licenseType> <termsHash>");
  process.exit(2);
}

function uuidv7() {
  const ms = Date.now();
  const hex = ms.toString(16).padStart(12, "0");
  return (
    hex.slice(0, 8) + "-" +
    hex.slice(8, 12) + "-" +
    "7" + Math.floor(Math.random() * 0xfff).toString(16).padStart(3, "0") + "-" +
    (0x8000 | Math.floor(Math.random() * 0x3fff)).toString(16).padStart(4, "0") + "-" +
    Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, "0")
  );
}

const kp = await generateKeyPair();
const env = await createEnvelope({
  payload: {
    type: "license.request",
    request_id: uuidv7(),
    consumer: { id: kp.did },
    provider_id: providerDid,
    item_id: itemId,
    license_type: licenseType,
    terms_hash: termsHash,
    status: "OPEN",
  },
  author: kp.did,
  privateKey: kp.privateKey,
});

process.stdout.write(JSON.stringify(env));
