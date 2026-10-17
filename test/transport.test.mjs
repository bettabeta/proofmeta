// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { parseManifestUrl, wellKnownUrl } from "../dist/index.js";

test("parseManifestUrl accepts https and preserves the URL", () => {
  const r = parseManifestUrl("https://provider.example/.well-known/proofmeta.json");
  assert.equal(r.ok, true);
  assert.equal(r.url.href, "https://provider.example/.well-known/proofmeta.json");
});

test("parseManifestUrl rejects input the WHATWG parser would silently repair", () => {
  for (const u of [
    " https://provider.example/m.json",
    "https://provider.example/m.json\n",
    "https://provider\t.example/m.json",
    "",
  ]) {
    assert.equal(parseManifestUrl(u).error.code, "URL_INVALID", JSON.stringify(u));
  }
});

test("parseManifestUrl rejects relative URLs, credentials, and unsupported schemes", () => {
  assert.equal(parseManifestUrl("/m.json").error.code, "URL_INVALID");
  assert.equal(parseManifestUrl("https://u:p@provider.example/m.json").error.code, "URL_CREDENTIALS");
  for (const u of [
    "http://provider.example/m.json",
    "ipfs://bafy/m.json",
    "ar://abc/m.json",
    "file:///etc/passwd",
    "data:,{}",
  ]) {
    assert.equal(parseManifestUrl(u).error.code, "SCHEME_UNSUPPORTED", u);
  }
});

test("allowHttpLoopback only opens http for loopback hosts", () => {
  const opts = { allowHttpLoopback: true };
  for (const u of ["http://127.0.0.1:8080/m.json", "http://localhost/m.json", "http://[::1]:1/m.json"]) {
    assert.equal(parseManifestUrl(u, opts).ok, true, u);
  }
  for (const u of ["http://10.0.0.1/m.json", "http://127.0.0.2/m.json", "http://localhost.provider.example/m.json"]) {
    assert.equal(parseManifestUrl(u, opts).error.code, "SCHEME_UNSUPPORTED", u);
  }
});

test("wellKnownUrl builds the §3.7 URL and lowercases the host", () => {
  assert.equal(
    wellKnownUrl("Sub.Provider.Example").url.href,
    "https://sub.provider.example/.well-known/proofmeta.json",
  );
});

test("wellKnownUrl converts IDNs to their ASCII form", () => {
  assert.equal(wellKnownUrl("bücher.example").url.href, "https://xn--bcher-kva.example/.well-known/proofmeta.json");
});
