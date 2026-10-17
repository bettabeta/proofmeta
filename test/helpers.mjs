// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import http from "node:http";
import { createEnvelope, generateKeyPair } from "@proofmeta/sdk-ts";

export function manifestPayload(did) {
  return {
    type: "manifest",
    provider: { id: did, name: "Example Provider" },
    request_endpoint: "https://provider.example/proofmeta/request",
    license_types: [
      {
        id: "standard",
        terms_url: "https://provider.example/terms/standard",
        terms_hash: "sha256:" + "0".repeat(64),
        scope: ["commercial"],
      },
    ],
    items: [{ item_id: "item-001", name: "Item 001", available_licenses: ["standard"] }],
  };
}

export async function signedManifest(payloadFn = manifestPayload) {
  const kp = await generateKeyPair();
  const envelope = await createEnvelope({ payload: payloadFn(kp.did), author: kp.did, privateKey: kp.privateKey });
  return { kp, envelope };
}

export function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/** Loopback HTTP server; `routes` maps a path to (req, res) => void. */
export async function serve(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url];
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function sendBytes(bytes, headers = { "content-type": "application/json" }) {
  return (_req, res) => {
    res.writeHead(200, headers);
    res.end(bytes);
  };
}

/** A fetch stub that serves fixed responses by URL, for https-only paths. */
export function stubFetch(map) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const entry = map[url];
    if (!entry) return new Response(null, { status: 404 });
    return typeof entry === "function" ? entry(url, init) : entry();
  };
  fn.calls = calls;
  return fn;
}
