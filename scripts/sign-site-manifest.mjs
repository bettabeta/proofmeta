// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Signs or checks site/.well-known/proofmeta.json.
 *
 * Every terms_hash and content_hash is recomputed from the files the manifest
 * describes; nothing is carried over from the previous manifest. --check fails
 * if any published hash no longer matches its source file.
 *
 * Usage:
 *   PROOFMETA_SITE_SEED=<64 hex> node scripts/sign-site-manifest.mjs
 *   node scripts/sign-site-manifest.mjs --check
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnvelope, keyPairFromPrivate } from "../packages/sdk-ts/dist/index.js";
import { acceptProtocolInput } from "../packages/sdk-ts/dist/acceptance.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, "site/.well-known/proofmeta.json");
const SPEC_REPO_RAW = "https://raw.githubusercontent.com/bettabeta/proofmeta";

const LICENSE_SOURCES = {
  "apache-2.0": "site/license.txt",
};

const ITEM_SOURCES = {
  "protocol-specification": {
    file: "SPEC.md",
    description: "SPEC.md — the master specification of the ProofMeta protocol.",
  },
  "browser-tools-bundle": {
    file: "site/tools/proofmeta-tools.min.js",
    description:
      "proofmeta-tools.min.js — the client-side SDK bundle powering the manifest generator and verifier.",
  },
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fileHash = (rel) => sha256(readFileSync(path.join(root, rel)));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "buffer" });

function sameKeys(actual, expected, what) {
  const a = [...actual].sort().join(",");
  const e = [...expected].sort().join(",");
  if (a !== e) throw new Error(`${what}: manifest has [${a}], sources define [${e}]`);
}

/** Returns a list of mismatches; empty means the manifest matches the files. */
export async function checkManifest(envelope) {
  const problems = [];
  const report = await acceptProtocolInput(
    { kind: "value", value: envelope },
    { operation: "manifest", purpose: "protocol-conformance" },
  );
  if (!report.accepted) problems.push(`manifest not accepted: ${JSON.stringify(report.errors)}`);
  const payload = envelope?.payload ?? {};
  try {
    sameKeys((payload.license_types ?? []).map((l) => l.id), Object.keys(LICENSE_SOURCES), "license_types");
    sameKeys((payload.items ?? []).map((i) => i.item_id), Object.keys(ITEM_SOURCES), "items");
  } catch (e) {
    problems.push(e.message);
    return problems;
  }
  for (const lt of payload.license_types) {
    const want = fileHash(LICENSE_SOURCES[lt.id]);
    if (lt.terms_hash !== want) problems.push(`license ${lt.id}: terms_hash ${lt.terms_hash} != ${want}`);
  }
  for (const item of payload.items) {
    const src = ITEM_SOURCES[item.item_id];
    const want = fileHash(src.file);
    if (item.content_hash !== want) {
      problems.push(`item ${item.item_id}: content_hash ${item.content_hash} != ${want} (${src.file})`);
    }
    if (item.description !== src.description) problems.push(`item ${item.item_id}: stale description`);
  }
  return problems;
}

/** Latest origin/main commit touching SPEC.md; its blob must equal the working tree. */
function specCommit() {
  const commit = git("log", "-1", "--format=%H", "origin/main", "--", "SPEC.md").toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("cannot resolve SPEC.md commit on origin/main");
  const pinned = sha256(git("show", `${commit}:SPEC.md`));
  if (pinned !== fileHash("SPEC.md")) {
    throw new Error(`working-tree SPEC.md differs from origin/main ${commit}; push it first`);
  }
  return commit;
}

async function sign(previous) {
  const seedHex = process.env.PROOFMETA_SITE_SEED ?? "";
  if (!/^[0-9a-f]{64}$/i.test(seedHex)) throw new Error("PROOFMETA_SITE_SEED must be 64 hex characters");
  const kp = await keyPairFromPrivate(Uint8Array.from(Buffer.from(seedHex, "hex")));
  const payload = structuredClone(previous.payload);
  if (payload.provider?.id !== kp.did) {
    throw new Error(`seed DID ${kp.did} != provider.id ${payload.provider?.id}; rotate provider.id explicitly`);
  }
  sameKeys(payload.license_types.map((l) => l.id), Object.keys(LICENSE_SOURCES), "license_types");
  sameKeys(payload.items.map((i) => i.item_id), Object.keys(ITEM_SOURCES), "items");

  for (const lt of payload.license_types) lt.terms_hash = fileHash(LICENSE_SOURCES[lt.id]);
  const commit = specCommit();
  for (const item of payload.items) {
    const src = ITEM_SOURCES[item.item_id];
    item.description = src.description;
    item.content_hash = fileHash(src.file);
    if (item.item_id === "protocol-specification") {
      item.metadata = { ...item.metadata, url: `${SPEC_REPO_RAW}/${commit}/SPEC.md` };
    }
  }
  return createEnvelope({ payload, author: kp.did, privateKey: kp.privateKey });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = JSON.parse(readFileSync(manifestPath, "utf8"));
  const envelope = process.argv.includes("--check") ? current : await sign(current);
  const problems = await checkManifest(envelope);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  if (envelope !== current) writeFileSync(manifestPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(
    JSON.stringify({
      status: envelope === current ? "ok" : "signed",
      payload_hash: envelope.payload_hash,
      items: Object.fromEntries(envelope.payload.items.map((i) => [i.item_id, i.content_hash])),
    }),
  );
}
