// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tier-1 end-to-end test.
 *
 * 1. Spawns the reference Provider on an ephemeral port.
 * 2. Waits for it to be listening.
 * 3. Runs the reference Consumer against it.
 * 4. Reports success / failure based on exit codes.
 *
 * Success means: manifest signed + verified, OPEN envelope signed + verified,
 * server-side PENDING + GRANTED envelopes signed + chain-verified — all with
 * zero external dependencies, proving §9 Success Criterion #3.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const PORT = 4101;
const ORIGIN = `http://127.0.0.1:${PORT}`;

console.log("[e2e] spawning provider…");
const provider = spawn(
  "node",
  [path.join(repoRoot, "examples/provider/server.mjs")],
  {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", PUBLIC_ORIGIN: ORIGIN },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

provider.stdout.on("data", (b) => process.stdout.write(`[provider] ${b}`));
provider.stderr.on("data", (b) => process.stderr.write(`[provider-err] ${b}`));

// Wait up to 5s for the server to be ready.
const started = await waitForPort(PORT, 5000);
if (!started) {
  provider.kill();
  console.error("[e2e] provider did not start in time");
  process.exit(1);
}

console.log("[e2e] provider ready — running consumer…");
const consumer = spawn(
  "node",
  [path.join(repoRoot, "examples/consumer/client.mjs")],
  {
    env: { ...process.env, PROVIDER_ORIGIN: ORIGIN },
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolve) => {
  consumer.on("close", resolve);
});

provider.kill("SIGTERM");

if (exitCode !== 0) {
  console.error(`[e2e] FAIL — consumer exited with ${exitCode}`);
  process.exit(exitCode ?? 1);
}
console.log("[e2e] PASS — Tier-1 end-to-end flow completed");
process.exit(0);

// ── helpers ───────────────────────────────────────────────────────────────

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/.well-known/proofmeta.json`);
      if (res.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
