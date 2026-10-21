// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * The browser generator (site/generate/*.js, plain scripts behind a
 * self-only CSP) carries copies of the CLI's preset table and key-file
 * format. These tests load the browser files into this process and require
 * identical output, so the two cannot drift silently.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyPairFromPrivate } from "@proofmeta/sdk-ts";

import * as cli from "../src/presets.mjs";
import { plainKeyFile, encryptedKeyFile, keyPairFromKeyFile } from "../src/keyfile.mjs";

const site = (name) => new URL(`../../../site/generate/${name}`, import.meta.url);
for (const f of ["presets.js", "keyfile.js", "zip.js"]) runInThisContext(readFileSync(site(f), "utf8"), { filename: f });
const browser = globalThis.ProofMetaPresets;
const browserKey = globalThis.ProofMetaKeyFile;
const zip = globalThis.ProofMetaZip;

const keyPair = await keyPairFromPrivate(new Uint8Array(32).fill(9));
const sample = { publisher: "Example Press", origin: "https://example.test", date: "2026-01-01" };

test("preset table is identical in CLI and browser", () => {
  assert.deepEqual(browser.PRESETS, cli.PRESETS);
  assert.deepEqual(browser.SCOPE_MEANING, cli.SCOPE_MEANING);
});

test("terms text, requests page and hosting notes render identically", () => {
  for (const preset of cli.PRESETS) {
    assert.equal(browser.termsText({ preset, ...sample }), cli.termsText({ preset, ...sample }), preset.id);
    for (const contact of [undefined, "mailto:a@example.test", "https://example.test/contact"]) {
      const args = { publisher: sample.publisher, origin: sample.origin, preset, contact, termsUrl: `${sample.origin}/.well-known/proofmeta-terms/${preset.id}.txt` };
      assert.equal(browser.requestsHtml(args), cli.requestsHtml(args), `${preset.id} ${contact}`);
    }
    for (const keyFile of [undefined, "proofmeta-key.json"]) {
      const args = { origin: sample.origin, licenseId: preset.id, keyFile };
      assert.equal(browser.hostingReadme(args), cli.hostingReadme(args));
    }
  }
});

test("requests page escapes publisher-controlled text", () => {
  const html = cli.requestsHtml({ publisher: '<script>alert(1)</script>', origin: "https://example.test", preset: cli.PRESETS[0], contact: 'mailto:a@b.co"onclick="x', termsUrl: "https://example.test/t" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /"onclick=/);
});

test("key files written in Node open in the browser code and vice versa", async () => {
  const fromNodePlain = plainKeyFile(keyPair);
  assert.deepEqual(await browserKey.privateKeyFrom(fromNodePlain), keyPair.privateKey);
  const fromNodeEnc = encryptedKeyFile(keyPair, "correct horse battery");
  assert.deepEqual(await browserKey.privateKeyFrom(fromNodeEnc, async () => "correct horse battery"), keyPair.privateKey);
  await assert.rejects(browserKey.privateKeyFrom(fromNodeEnc, async () => "wrong"), /wrong passphrase/);

  const fromBrowserPlain = browserKey.plain(keyPair);
  assert.equal((await keyPairFromKeyFile(fromBrowserPlain)).did, keyPair.did);
  const fromBrowserEnc = await browserKey.encrypt(keyPair, "correct horse battery");
  assert.equal(fromBrowserEnc.kdf.iterations, fromNodeEnc.kdf.iterations);
  assert.equal((await keyPairFromKeyFile(fromBrowserEnc, async () => "correct horse battery")).did, keyPair.did);
  await assert.rejects(keyPairFromKeyFile(fromBrowserEnc, async () => "wrong"), /wrong passphrase/);
  await assert.rejects(browserKey.encrypt(keyPair, "short"), /at least 8/);
  await assert.rejects(browserKey.privateKeyFrom({ ...fromBrowserEnc, kdf: { ...fromBrowserEnc.kdf, name: "scrypt" } }, async () => "x"), /unsupported kdf/);
});

test("browser-encrypted key signs through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofmeta-parity-"));
  try {
    const keyPath = join(dir, "k.json");
    const payloadPath = join(dir, "p.json");
    return browserKey.encrypt(keyPair, "correct horse battery").then((file) => {
      writeFileSync(keyPath, JSON.stringify(file));
      writeFileSync(payloadPath, JSON.stringify({ type: "status.update", status: "GRANTED", subject: { id: "s" }, policy: { ref: "https://example.test/p" } }));
      const out = execFileSync(process.execPath, [...process.execArgv.filter((a) => a === "--experimental-global-webcrypto"), new URL("../bin/proofmeta.mjs", import.meta.url).pathname, "sign", payloadPath, "--key", keyPath], { encoding: "utf8", env: { ...process.env, PROOFMETA_PASSPHRASE: "correct horse battery" }, stdio: ["ignore", "pipe", "pipe"] });
      assert.equal(JSON.parse(out).author, keyPair.did);
    }).finally(() => rmSync(dir, { recursive: true, force: true }));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
});

test("zip writer produces an archive the platform unzip can read back byte for byte", () => {
  const entries = [
    { name: ".well-known/proofmeta.json", data: '{"a":1}\n' },
    { name: ".well-known/proofmeta-terms/x.txt", data: "terms — ünïcödé\n" },
    { name: "requests.html", data: new TextEncoder().encode("<!doctype html>\n") },
  ];
  const bytes = zip.build(entries, new Date(2026, 0, 1, 12, 0, 0));
  assert.equal(zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const dir = mkdtempSync(join(tmpdir(), "proofmeta-zip-"));
  try {
    writeFileSync(join(dir, "a.zip"), bytes);
    let unzip = "unzip";
    try { execFileSync(unzip, ["-v"], { stdio: "ignore" }); } catch { unzip = null; }
    if (unzip) {
      execFileSync(unzip, ["-tq", join(dir, "a.zip")], { stdio: "ignore" });
      execFileSync(unzip, ["-q", join(dir, "a.zip"), "-d", join(dir, "out")], { stdio: "ignore" });
      for (const e of entries) {
        const got = readFileSync(join(dir, "out", e.name));
        assert.deepEqual(new Uint8Array(got), typeof e.data === "string" ? new TextEncoder().encode(e.data) : e.data, e.name);
      }
    } else {
      // No unzip binary: check structure markers and sizes only.
      assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); assert.equal(bytes[2], 3); assert.equal(bytes[3], 4);
      const end = bytes.length - 22;
      assert.deepEqual([...bytes.subarray(end, end + 4)], [0x50, 0x4b, 5, 6]);
      assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(end + 10, true), entries.length);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
