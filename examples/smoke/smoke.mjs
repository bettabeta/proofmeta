// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Local end-to-end smoke test, offline:
 *   1. sign a throwaway manifest with @proofmeta/sdk-ts
 *   2. serve it (and a tampered copy) on 127.0.0.1
 *   3. spawn `node dist/cli.js` over stdio, exactly as an MCP client would
 *   4. call both tools and check the fail-closed outcomes
 *
 * Usage: npm run smoke
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createEnvelope, generateKeyPair } from "@proofmeta/sdk-ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const kp = await generateKeyPair();
const manifest = await createEnvelope({
  author: kp.did,
  privateKey: kp.privateKey,
  payload: {
    type: "manifest",
    provider: { id: kp.did, name: "Smoke Test Provider" },
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
  },
});
const tampered = structuredClone(manifest);
tampered.payload.request_endpoint = "https://attacker.example/request";

const files = {
  "/.well-known/proofmeta.json": JSON.stringify(manifest),
  "/tampered.json": JSON.stringify(tampered),
};
const httpServer = http.createServer((req, res) => {
  const body = files[req.url];
  if (body === undefined) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "application/json" }).end(body);
});
await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${httpServer.address().port}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist/cli.js")],
  env: { ...process.env, PROOFMETA_MCP_ALLOW_HTTP_LOOPBACK: "1" },
  stderr: "inherit",
});
const client = new Client({ name: "proofmeta-mcp-smoke", version: "0.0.0" });

const checks = [];
function check(name, ok, detail) {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const first = (res) => res.content[0].text.split("\n")[0];

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  check(
    "tools/list",
    tools
      .map((t) => t.name)
      .sort()
      .join(",") === "discover_manifest,verify_manifest",
    tools.map((t) => t.name).join(", "),
  );

  const ok = await client.callTool({
    name: "verify_manifest",
    arguments: { url: `${base}/.well-known/proofmeta.json` },
  });
  check("valid manifest is accepted", ok.isError === false && ok.structuredContent.accepted === true, first(ok));

  const bad = await client.callTool({ name: "verify_manifest", arguments: { url: `${base}/tampered.json` } });
  check(
    "tampered manifest is rejected",
    bad.isError === true && bad.structuredContent.accepted === false && !("manifest" in bad.structuredContent),
    first(bad),
  );

  const missing = await client.callTool({ name: "verify_manifest", arguments: { url: `${base}/nope.json` } });
  check(
    "404 is rejected",
    missing.isError === true && missing.structuredContent.transport.code === "HTTP_STATUS",
    first(missing),
  );

  const disc = await client.callTool({ name: "discover_manifest", arguments: { domain: "localhost" } });
  check(
    "discover_manifest rejects non-FQDN",
    disc.isError === true && disc.structuredContent.transport.code === "DOMAIN_INVALID",
    first(disc),
  );
} finally {
  await client.close().catch(() => {});
  httpServer.close();
}

const failed = checks.filter((c) => !c).length;
console.log(
  failed === 0 ? `\nsmoke: ${checks.length}/${checks.length} passed` : `\nsmoke: ${failed} of ${checks.length} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
