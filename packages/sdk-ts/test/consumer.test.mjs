// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

import {
  createEnvelope,
  generateKeyPair,
  requestLicense,
  updateStatus,
} from "../dist/index.js";

const referenceProvider = fileURLToPath(
  new URL("../../../examples/provider/server.mjs", import.meta.url),
);

test("requestLicense completes against the reference provider", async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const provider = spawn(process.execPath, [referenceProvider], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  provider.stdout.resume();
  provider.stderr.resume();

  try {
    await waitForProvider(`${origin}/.well-known/proofmeta.json`);
    const keyPair = await generateKeyPair();
    const result = await requestLicense({
      manifestUrl: `${origin}/.well-known/proofmeta.json`,
      itemId: "cost-optimizer-skill@0.1",
      licenseType: "free-attribution",
      keyPair,
      pollTimeoutMs: 2_000,
      pollIntervalMs: 10,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "GRANTED");
    assert.equal(result.chain.length, 3);
  } finally {
    provider.kill("SIGTERM");
    await new Promise((resolve) => provider.once("exit", resolve));
  }
});

test("requestLicense rejects a manifest that fails acceptance", async () => {
  await withServer(
    (_req, res) => json(res, 200, { type: "not-an-envelope" }),
    async (origin) => {
      const result = await requestLicense({
        manifestUrl: `${origin}/manifest`,
        itemId: "item",
        licenseType: "free",
        keyPair: await generateKeyPair(),
      });

      assert.deepEqual(result, {
        ok: false,
        reason: "manifest acceptance failed: SCHEMA_INVALID",
      });
    },
  );
});

test("requestLicense returns a verified DENIED result as a failure", async () => {
  await withLifecycleProvider("DENIED", async (manifestUrl) => {
    const result = await requestLicense({
      manifestUrl,
      itemId: "item",
      licenseType: "free",
      keyPair: await generateKeyPair(),
      pollTimeoutMs: 500,
      pollIntervalMs: 5,
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "provider returned DENIED",
    });
  });
});

test("requestLicense fails closed when polling times out", async () => {
  await withLifecycleProvider("PENDING", async (manifestUrl) => {
    const result = await requestLicense({
      manifestUrl,
      itemId: "item",
      licenseType: "free",
      keyPair: await generateKeyPair(),
      pollTimeoutMs: 20,
      pollIntervalMs: 5,
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "poll timeout waiting for a terminal license status",
    });
  });
});

test("requestLicense identifies network failures", async () => {
  const result = await requestLicense({
    manifestUrl: "http://127.0.0.1:1/.well-known/proofmeta.json",
    itemId: "item",
    licenseType: "free",
    keyPair: await generateKeyPair(),
    pollTimeoutMs: 20,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /^network error /);
  assert.doesNotMatch(result.reason, /malformed envelope/);
});

async function withLifecycleProvider(finalStatus, run) {
  const provider = await generateKeyPair();
  const termsHash = `sha256:${"0".repeat(64)}`;
  let manifest;
  const chains = new Map();

  await withServer(async (req, res, origin) => {
    if (req.method === "GET" && req.url === "/manifest") {
      manifest ??= await createEnvelope({
        payload: {
          type: "manifest",
          provider: { id: provider.did },
          request_endpoint: `${origin}/requests`,
          items: [
            {
              item_id: "item",
              name: "Item",
              available_licenses: ["free"],
            },
          ],
          license_types: [
            {
              id: "free",
              terms_url: `${origin}/terms`,
              terms_hash: termsHash,
              scope: ["non-commercial"],
            },
          ],
        },
        author: provider.did,
        privateKey: provider.privateKey,
      });
      return json(res, 200, manifest);
    }

    if (req.method === "POST" && req.url === "/requests") {
      const open = JSON.parse(await readBody(req));
      const pending = await updateStatus(
        open,
        "PENDING",
        provider.did,
        provider.privateKey,
      );
      const chain = [open, pending];
      if (finalStatus === "DENIED") {
        chain.push(
          await updateStatus(
            pending,
            "DENIED",
            provider.did,
            provider.privateKey,
          ),
        );
      }
      chains.set(open.payload.request_id, chain);
      return json(res, 200, { chain });
    }

    const match = req.url?.match(/^\/requests\/([^?]+)$/);
    if (req.method === "GET" && match) {
      return json(
        res,
        200,
        chains.get(decodeURIComponent(match[1]))?.at(-1),
      );
    }
    return json(res, 404, { error: "not found" });
  }, async (origin) => run(`${origin}/manifest`));
}

async function withServer(handler, run) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, server.origin)).catch((error) => {
      json(res, 500, { error: String(error) });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  server.origin = `http://127.0.0.1:${address.port}`;
  try {
    await run(server.origin);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForProvider(url) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("reference provider did not start");
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function json(res, status, body) {
  const value = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(value),
  });
  res.end(value);
}
