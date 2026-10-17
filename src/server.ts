// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { discoverManifest, verifyManifest, type ManifestResult } from "./manifest.js";
import type { TransportOptions } from "./transport.js";

export const SERVER_NAME = "proofmeta-mcp";
export const SERVER_VERSION = "0.1.0";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function summary(r: ManifestResult): string {
  if (r.accepted)
    return `ACCEPTED: ${r.url} is a valid ProofMeta manifest (protocol conformance only; no operational authorization).`;
  if (!r.transport.ok) return `REJECTED: ${r.url || "(no URL)"} — ${r.transport.code}: ${r.transport.detail}`;
  const codes = r.report?.errors.map((e) => `${e.code}${e.path ? ` at ${e.path}` : ""}`).join(", ") || "not accepted";
  return `REJECTED: ${r.url} — ${codes}`;
}

function toToolResult(r: ManifestResult) {
  return {
    content: [{ type: "text" as const, text: `${summary(r)}\n\n${JSON.stringify(r, null, 2)}` }],
    structuredContent: r as unknown as Record<string, unknown>,
    isError: !r.accepted,
  };
}

export function createServer(opts: TransportOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "verify_manifest",
    {
      title: "Verify ProofMeta manifest",
      description:
        "Fetch a ProofMeta License Manifest from an https URL (one GET, no redirects) and verify it with @proofmeta/sdk-ts " +
        "(transport bytes, schema, payload hash, signature, author authority). Fail-closed: `accepted` is true only when every " +
        "check passes; the manifest is returned only when accepted. Acceptance is protocol conformance, not authorization to use anything.",
      inputSchema: { url: z.string().min(1).max(2048).describe("Absolute https URL of a manifest envelope") },
      annotations: READ_ONLY,
    },
    async ({ url }) => toToolResult(await verifyManifest(url, opts)),
  );

  server.registerTool(
    "discover_manifest",
    {
      title: "Discover ProofMeta manifest",
      description:
        "Fetch https://{domain}/.well-known/proofmeta.json (ProofMeta v1 discovery, §3.7) and verify it exactly like verify_manifest. " +
        "No registry, DNS TXT, or crawling. Redirects are reported, not followed.",
      inputSchema: {
        domain: z.string().min(1).max(253).describe("Bare DNS domain, e.g. example.com (no scheme, port, or path)"),
      },
      annotations: READ_ONLY,
    },
    async ({ domain }) => toToolResult(await discoverManifest(domain, opts)),
  );

  return server;
}
