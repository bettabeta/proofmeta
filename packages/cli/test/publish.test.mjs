// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyPairFromPrivate } from "@proofmeta/sdk-ts";
import { acceptProtocolInput } from "@proofmeta/sdk-ts/acceptance";

import { PRESETS, termsText } from "../src/presets.mjs";
import { plainKeyFile, encryptedKeyFile, keyPairFromKeyFile } from "../src/keyfile.mjs";
import { buildPolicy, signPayload, sha256Ref, normalizeOrigin, normalizeContact } from "../src/publish.mjs";
import { resolveManifestUrl, fetchManifestBytes, formatManifestSummary } from "../src/fetch.mjs";

const cliBin = new URL("../bin/proofmeta.mjs", import.meta.url).pathname;
const keyPair = await keyPairFromPrivate(new Uint8Array(32).fill(7));
const encoder = new TextEncoder();

const nodeArgs = (args) => [...process.execArgv.filter((a) => a === "--experimental-global-webcrypto"), cliBin, ...args];
const childEnv = (env) => ({ ...process.env, PROOFMETA_PASSPHRASE: "", ...env });
function invoke(args, { cwd, env = {}, input } = {}) {
  return spawnSync(process.execPath, nodeArgs(args), { encoding: "utf8", cwd, input, env: childEnv(env) });
}
/** Async variant for commands that talk to a server running in this process. */
function invokeAsync(args, { cwd, env = {} } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, nodeArgs(args), { cwd, env: childEnv(env), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => { stdout += d; });
    child.stderr.setEncoding("utf8").on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}
function tmp() {
  return mkdtempSync(join(tmpdir(), "proofmeta-publish-"));
}

// ── presets ──────────────────────────────────────────────────────────────

test("every preset uses only core tags, no conflict pair, and builds an accepted manifest", async () => {
  const core = new Set(["commercial", "non-commercial", "derivative-allowed", "attribution-required", "ai-training-allowed", "ai-training-excluded", "sublicense-allowed", "revocable"]);
  for (const preset of PRESETS) {
    for (const tag of preset.scope) assert.ok(core.has(tag), `${preset.id}: ${tag}`);
    assert.ok(!(preset.scope.includes("commercial") && preset.scope.includes("non-commercial")), preset.id);
    assert.ok(!(preset.scope.includes("ai-training-allowed") && preset.scope.includes("ai-training-excluded")), preset.id);
    assert.ok(preset.scope.includes("ai-training-allowed") || preset.scope.includes("ai-training-excluded"), `${preset.id}: AI training must be explicit`);
    const policy = await buildPolicy({ keyPair, name: "Test Publisher", origin: "https://example.test", presetId: preset.id, date: "2026-01-01", timestamp: "2026-01-01T00:00:00Z" });
    assert.equal(policy.report.accepted, true, `${preset.id}: ${JSON.stringify(policy.report.errors)}`);
    assert.deepEqual(policy.manifest.payload.license_types[0].scope, preset.scope);
  }
});

test("terms text restates the request requirement and the tags", () => {
  const ask = PRESETS.find((p) => p.request_required);
  const open = PRESETS.find((p) => !p.request_required);
  const a = termsText({ preset: ask, publisher: "P", origin: "https://e.test", date: "2026-01-01" });
  const o = termsText({ preset: open, publisher: "P", origin: "https://e.test", date: "2026-01-01" });
  assert.match(a, /No use is permitted before .* GRANTED/);
  assert.match(o, /without sending a request/);
  assert.match(a, new RegExp(`Machine-readable scope tags: ${ask.scope.join(", ")}`));
});

// ── buildPolicy ──────────────────────────────────────────────────────────

test("terms_hash binds the shipped terms file and endpoints point at the origin", async () => {
  const policy = await buildPolicy({ keyPair, name: "Test Publisher", origin: "https://example.test/", presetId: "open-attribution", contact: "me@example.test", date: "2026-01-01" });
  const lt = policy.manifest.payload.license_types[0];
  const termsFile = policy.files.get(".well-known/proofmeta-terms/open-attribution.txt");
  assert.equal(lt.terms_hash, sha256Ref(encoder.encode(termsFile)));
  assert.equal(lt.terms_url, "https://example.test/.well-known/proofmeta-terms/open-attribution.txt");
  assert.equal(policy.manifest.payload.request_endpoint, "https://example.test/requests.html");
  assert.equal(policy.manifest.author, keyPair.did);
  assert.equal(policy.manifest.payload.provider.id, keyPair.did);
  assert.match(policy.files.get("requests.html"), /mailto:me@example\.test/);
  assert.match(policy.files.get("requests.html"), /No license request is required/);
  const ask = await buildPolicy({ keyPair, name: "P", origin: "https://example.test", presetId: "ask-first" });
  assert.match(ask.files.get("requests.html"), /A license request is required/);
  assert.match(ask.files.get("requests.html"), /has not listed a contact/);
  // The written manifest bytes are what the SDK accepted.
  const again = await acceptProtocolInput({ kind: "bytes", bytes: encoder.encode(policy.files.get(".well-known/proofmeta.json")) }, { operation: "manifest", purpose: "protocol-conformance" });
  assert.equal(again.accepted, true);
});

test("buildPolicy rejects bad input instead of signing it", async () => {
  await assert.rejects(buildPolicy({ keyPair, name: "P", origin: "https://example.test", presetId: "nope" }), /unknown preset/);
  await assert.rejects(buildPolicy({ keyPair, name: "  ", origin: "https://example.test", presetId: "ask-first" }), /name is required/);
  await assert.rejects(buildPolicy({ keyPair, name: "P", origin: "https://example.test/blog", presetId: "ask-first" }), /scheme and host only/);
  await assert.rejects(buildPolicy({ keyPair, name: "P", origin: "ftp://example.test", presetId: "ask-first" }), /https/);
  await assert.rejects(buildPolicy({ keyPair, name: "P", origin: "example.test", presetId: "ask-first" }), /absolute URL/);
  await assert.rejects(buildPolicy({ keyPair, name: "P", origin: "https://example.test", presetId: "ask-first", contact: "not a contact" }), /contact/);
  assert.equal(normalizeOrigin("HTTPS://Example.test/"), "https://example.test");
  assert.equal(normalizeContact("a@b.co"), "mailto:a@b.co");
  assert.equal(normalizeContact("https://b.co/contact"), "https://b.co/contact");
  assert.equal(normalizeContact("  "), undefined);
  assert.throws(() => normalizeContact("javascript:alert(1)"), /mailto/);
});

// ── signPayload ──────────────────────────────────────────────────────────

test("signPayload self-checks manifests fully and other payloads by inspection", async () => {
  const manifestPayload = { type: "manifest", provider: { id: keyPair.did }, request_endpoint: "https://p.test/r", catalog_endpoint: "https://p.test/c", license_types: [{ id: "l", terms_url: "https://p.test/t", terms_hash: "sha256:" + "0".repeat(64), scope: ["commercial"] }] };
  const ok = await signPayload({ payload: manifestPayload, keyPair, timestamp: "2026-01-01T00:00:00Z" });
  assert.equal(ok.report.operation, "manifest");
  assert.equal(ok.report.accepted, true);
  const chained = await signPayload({ payload: manifestPayload, keyPair, inReplyTo: "sha256:" + "a".repeat(64) });
  assert.equal(chained.report.accepted, false);
  assert.equal(chained.report.errors[0].code, "ROOT_INVALID");
  const att = await signPayload({ payload: { type: "status.update", status: "GRANTED", subject: { id: "s" }, policy: { ref: "https://p.test/policy" } }, keyPair });
  assert.equal(att.report.operation, "inspect-envelope");
  assert.deepEqual(att.report.errors, []);
  assert.equal(att.report.accepted, false);
  const badScope = await signPayload({ payload: { ...manifestPayload, license_types: [{ ...manifestPayload.license_types[0], scope: ["commercial", "non-commercial"] }] }, keyPair });
  assert.equal(badScope.report.errors[0].code, "SCOPE_INVALID");
  await assert.rejects(signPayload({ payload: [], keyPair }), /JSON object/);
  await assert.rejects(signPayload({ payload: { noType: true }, keyPair }), /type/);
});

// ── key files ────────────────────────────────────────────────────────────

test("key files round-trip in plain and encrypted form and fail closed otherwise", async () => {
  const plain = plainKeyFile(keyPair);
  assert.equal((await keyPairFromKeyFile(plain)).did, keyPair.did);
  // Older generator backups have no proofmeta_key marker.
  assert.equal((await keyPairFromKeyFile({ did: keyPair.did, private_key_hex: plain.private_key_hex })).did, keyPair.did);
  const enc = encryptedKeyFile(keyPair, "correct horse");
  assert.equal(enc.private_key_hex, undefined);
  assert.equal(enc.kdf.name, "PBKDF2");
  assert.equal(enc.cipher.name, "AES-GCM");
  assert.equal((await keyPairFromKeyFile(enc, async () => "correct horse")).did, keyPair.did);
  await assert.rejects(keyPairFromKeyFile(enc, async () => "wrong"), /wrong passphrase/);
  await assert.rejects(keyPairFromKeyFile({ ...enc, ciphertext: enc.ciphertext.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }, async () => "correct horse"), /wrong passphrase|corrupted/);
  await assert.rejects(keyPairFromKeyFile({ ...plain, did: "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" }), /does not match/);
  await assert.rejects(keyPairFromKeyFile({ ...enc, kdf: { ...enc.kdf, name: "scrypt" } }, async () => "x"), /unsupported kdf/);
  await assert.rejects(keyPairFromKeyFile({ did: keyPair.did }), /neither/);
  await assert.rejects(keyPairFromKeyFile([]), /JSON object/);
  assert.throws(() => encryptedKeyFile(keyPair, "short"), /at least 8/);
});

// ── fetch helpers ────────────────────────────────────────────────────────

test("resolveManifestUrl applies the well-known convention only when no path is given", () => {
  assert.equal(resolveManifestUrl("example.com"), "https://example.com/.well-known/proofmeta.json");
  assert.equal(resolveManifestUrl("https://example.com/"), "https://example.com/.well-known/proofmeta.json");
  assert.equal(resolveManifestUrl("https://example.com/custom.json"), "https://example.com/custom.json");
  assert.equal(resolveManifestUrl("http://127.0.0.1:4100"), "http://127.0.0.1:4100/.well-known/proofmeta.json");
  assert.throws(() => resolveManifestUrl("ipfs://bafy"), /http/);
  assert.throws(() => resolveManifestUrl(""), /required/);
});

test("fetchManifestBytes enforces status and size and summaries do not trust rejected input", async () => {
  const big = { ok: true, status: 200, url: "u", headers: new Map([["content-length", String(2 * 1024 * 1024)]]), arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(fetchManifestBytes("https://x.test/m", { fetchImpl: async () => big }), /larger/);
  const notOk = { ok: false, status: 503, url: "u", headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(fetchManifestBytes("https://x.test/m", { fetchImpl: async () => notOk }), /HTTP 503/);
  const body = encoder.encode("{}");
  const okRes = { ok: true, status: 200, url: "https://x.test/m", headers: new Map(), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  const got = await fetchManifestBytes("https://x.test/m", { fetchImpl: async () => okRes });
  assert.deepEqual([...got.bytes], [...body]);
  const rejected = await acceptProtocolInput({ kind: "bytes", bytes: got.bytes }, { operation: "manifest", purpose: "protocol-conformance" });
  const text = formatManifestSummary(rejected, got.finalUrl);
  assert.match(text, /REJECTED/);
  assert.doesNotMatch(text, /VALID MANIFEST/);
});

// ── CLI end to end: keygen → init → serve → fetch ────────────────────────

test("cli: keygen, init, hash, sign and fetch complete the publish loop against a loopback server", async () => {
  const dir = tmp();
  try {
    const keygen = invoke(["keygen", "--out", "k.json"], { cwd: dir });
    assert.equal(keygen.status, 0, keygen.stderr);
    const did = keygen.stdout.trim();
    assert.match(did, /^did:key:z6Mk/);
    assert.match(keygen.stderr, /PLAINTEXT/);
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "k.json")).mode & 0o777, 0o600);
    assert.equal(invoke(["keygen", "--out", "k.json"], { cwd: dir }).status, 2, "refuses to overwrite");

    const encKeygen = invoke(["keygen", "--out", "k.enc.json"], { cwd: dir, env: { PROOFMETA_PASSPHRASE: "correct horse" } });
    assert.equal(encKeygen.status, 0, encKeygen.stderr);
    assert.match(encKeygen.stderr, /encrypted/);
    assert.ok(!("private_key_hex" in JSON.parse(readFileSync(join(dir, "k.enc.json"), "utf8"))));

    const init = invoke(["init", "--name", "Example Press", "--origin", "https://example.test", "--preset", "attribution-no-training", "--contact", "hello@example.test", "--key", "k.json", "--out", "site"], { cwd: dir });
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, new RegExp(did));
    const manifestPath = join(dir, "site", ".well-known", "proofmeta.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.author, did);
    assert.ok(!existsSync(join(dir, "site", "proofmeta-key.json")), "no key copied when --key is given");
    assert.ok(existsSync(join(dir, "site", "README.txt")));
    assert.equal(invoke(["init", "--name", "x", "--origin", "https://example.test", "--preset", "ask-first", "--key", "k.json", "--out", "site"], { cwd: dir }).status, 2, "refuses existing out dir");

    const hash = invoke(["hash", join("site", ".well-known", "proofmeta-terms", "attribution-no-training.txt")], { cwd: dir });
    assert.equal(hash.status, 0, hash.stderr);
    assert.equal(hash.stdout.trim(), manifest.payload.license_types[0].terms_hash);

    const encInit = invoke(["init", "--name", "Example Press", "--origin", "https://example.test", "--preset", "ask-first", "--out", "site2"], { cwd: dir, env: { PROOFMETA_PASSPHRASE: "correct horse" } });
    assert.equal(encInit.status, 0, encInit.stderr);
    assert.match(encInit.stdout, /encrypted; do not upload it/);
    assert.ok("ciphertext" in JSON.parse(readFileSync(join(dir, "site2", "proofmeta-key.json"), "utf8")));

    writeFileSync(join(dir, "att.json"), JSON.stringify({ type: "status.update", status: "GRANTED", subject: { id: "s" }, policy: { ref: "https://example.test/p" } }));
    const signEnc = invoke(["sign", "att.json", "--key", join("site2", "proofmeta-key.json"), "--out", "att.signed.json"], { cwd: dir, env: { PROOFMETA_PASSPHRASE: "correct horse" } });
    assert.equal(signEnc.status, 0, signEnc.stderr);
    assert.equal(invoke(["sign", "att.json", "--key", join("site2", "proofmeta-key.json")], { cwd: dir, env: { PROOFMETA_PASSPHRASE: "wrong" } }).status, 2);
    const signed = JSON.parse(readFileSync(join(dir, "att.signed.json"), "utf8"));
    assert.equal(invoke(["validate", "att.signed.json"], { cwd: dir }).status, 0);
    assert.equal(signed.payload.status, "GRANTED");
    const signManifest = invoke(["sign", "att.json", "--key", "k.json", "--in-reply-to", "sha256:" + "a".repeat(64)], { cwd: dir });
    assert.equal(signManifest.status, 0, "attestation reply is only inspected");
    writeFileSync(join(dir, "m.json"), JSON.stringify(manifest.payload));
    const chainedManifest = invoke(["sign", "m.json", "--key", "k.json", "--in-reply-to", "sha256:" + "a".repeat(64)], { cwd: dir });
    assert.equal(chainedManifest.status, 1, "manifest with in_reply_to fails self-check");
    assert.match(chainedManifest.stderr, /ROOT_INVALID/);

    const server = http.createServer((req, res) => {
      if (req.url === "/.well-known/proofmeta.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(readFileSync(manifestPath)); }
      else if (req.url === "/bom.json") { res.writeHead(200); res.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(manifestPath)])); }
      else { res.writeHead(404); res.end("no"); }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const fetched = await invokeAsync(["fetch", origin]);
      assert.equal(fetched.status, 0, fetched.stderr);
      assert.match(fetched.stdout, /VALID MANIFEST/);
      assert.match(fetched.stdout, /Example Press/);
      assert.match(fetched.stdout, /ai-training-excluded \(AI training not allowed\)/);
      const json = await invokeAsync(["fetch", origin, "--json"]);
      assert.equal(json.status, 0);
      assert.equal(JSON.parse(json.stdout).accepted, true);
      const bom = await invokeAsync(["fetch", `${origin}/bom.json`]);
      assert.equal(bom.status, 1);
      assert.match(bom.stdout, /REJECTED — BOM_UNSUPPORTED/);
      const missing = await invokeAsync(["fetch", `${origin}/none.json`]);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /HTTP 404/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: usage errors and non-interactive init exit 2 without writing files", () => {
  const dir = tmp();
  try {
    for (const args of [["init", "--name", "x", "--origin", "https://e.test", "--out", "s"], ["init", "--bogus"], ["keygen", "extra"], ["hash"], ["hash", "a", "b"], ["sign", "x.json"], ["fetch"], ["fetch", "a", "b"], ["fetch", "ipfs://x"]]) {
      const r = invoke(args, { cwd: dir, input: "" });
      assert.equal(r.status, 2, JSON.stringify(args) + r.stderr);
    }
    assert.ok(!existsSync(join(dir, "s")));
    const list = invoke(["init", "--list-presets"]);
    assert.equal(list.status, 0);
    for (const p of PRESETS) assert.match(list.stdout, new RegExp(p.id));
    const help = invoke(["--help"]);
    assert.match(help.stdout, /proofmeta init/);
    assert.match(help.stdout, /proofmeta fetch/);
    assert.doesNotMatch(help.stdout, /Konformit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
