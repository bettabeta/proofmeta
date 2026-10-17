#!/usr/bin/env node
// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, type TransportOptions } from "./transport.js";

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

function flag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "" || raw === "0") return false;
  if (raw === "1") return true;
  throw new Error(`${name} must be "0" or "1", got ${JSON.stringify(raw)}`);
}

let opts: TransportOptions;
try {
  opts = {
    timeoutMs: positiveInt("PROOFMETA_MCP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxBytes: positiveInt("PROOFMETA_MCP_MAX_BYTES", DEFAULT_MAX_BYTES),
    allowHttpLoopback: flag("PROOFMETA_MCP_ALLOW_HTTP_LOOPBACK"),
  };
} catch (e) {
  console.error(`proofmeta-mcp: ${(e as Error).message}`);
  process.exit(2);
}

await createServer(opts).connect(new StdioServerTransport());
