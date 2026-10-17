// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/index.js";
import { jsonBytes, sendBytes, serve, signedManifest, stubFetch } from "./helpers.mjs";

async function connect(opts) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createServer(opts);
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, close: () => client.close() };
}

test("lists exactly verify_manifest and discover_manifest, read-only", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["discover_manifest", "verify_manifest"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }
  assert.deepEqual(tools.find((t) => t.name === "verify_manifest").inputSchema.required, ["url"]);
  assert.deepEqual(tools.find((t) => t.name === "discover_manifest").inputSchema.required, ["domain"]);
  await close();
});

test("verify_manifest tool returns ACCEPTED with structured content", async () => {
  const { envelope } = await signedManifest();
  const srv = await serve({ "/m.json": sendBytes(jsonBytes(envelope)) });
  const { client, close } = await connect({ allowHttpLoopback: true });
  try {
    const res = await client.callTool({ name: "verify_manifest", arguments: { url: `${srv.base}/m.json` } });
    assert.equal(res.isError, false);
    assert.match(res.content[0].text, /^ACCEPTED: /);
    assert.equal(res.structuredContent.accepted, true);
    assert.deepEqual(JSON.parse(JSON.stringify(res.structuredContent.manifest)), envelope);
  } finally {
    await close();
    await srv.close();
  }
});

test("verify_manifest tool is fail-closed: isError, REJECTED, no manifest", async () => {
  const { envelope } = await signedManifest();
  envelope.timestamp = "2026-10-17T00:00:00-00:00";
  const srv = await serve({ "/m.json": sendBytes(jsonBytes(envelope)) });
  const { client, close } = await connect({ allowHttpLoopback: true });
  try {
    const res = await client.callTool({ name: "verify_manifest", arguments: { url: `${srv.base}/m.json` } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^REJECTED: .*SCHEMA_INVALID at \/timestamp/);
    assert.equal(res.structuredContent.accepted, false);
    assert.equal("manifest" in res.structuredContent, false);
  } finally {
    await close();
    await srv.close();
  }
});

test("discover_manifest tool uses the well-known URL", async () => {
  const { envelope } = await signedManifest();
  const fetch = stubFetch({
    "https://provider.example/.well-known/proofmeta.json": () => new Response(jsonBytes(envelope), { status: 200 }),
  });
  const { client, close } = await connect({ fetch });
  const res = await client.callTool({ name: "discover_manifest", arguments: { domain: "provider.example" } });
  assert.equal(res.isError, false);
  assert.equal(res.structuredContent.domain, "provider.example");
  assert.equal(res.structuredContent.accepted, true);
  await close();
});

test("discover_manifest tool rejects a URL passed as domain", async () => {
  const { client, close } = await connect({ fetch: stubFetch({}) });
  const res = await client.callTool({ name: "discover_manifest", arguments: { domain: "https://provider.example" } });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent.transport.code, "DOMAIN_INVALID");
  await close();
});

test("missing arguments are rejected by the input schema", async () => {
  const { client, close } = await connect();
  const res = await client.callTool({ name: "verify_manifest", arguments: {} });
  assert.equal(res.isError, true);
  await close();
});
