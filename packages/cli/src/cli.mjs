// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Argv parsing for the `proofmeta` CLI. Keep this file dumb — actual
 * validation logic lives in src/validate.mjs so tests can exercise it
 * without spawning a subprocess.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateBytes, formatReport } from "./validate.mjs";
import { acceptProtocolInput, parseProtocolJson } from '@proofmeta/sdk-ts/acceptance';
import { generateKeyPair } from "@proofmeta/sdk-ts";
import { PRESETS, presetById } from "./presets.mjs";
import { plainKeyFile, encryptedKeyFile, keyPairFromKeyFile, isEncryptedKeyFile } from "./keyfile.mjs";
import { buildPolicy, signPayload, sha256Ref } from "./publish.mjs";
import { resolveManifestUrl, fetchManifestBytes, acceptManifestBytes, formatManifestSummary } from "./fetch.mjs";

const PASSPHRASE_ENV = "PROOFMETA_PASSPHRASE";

/** Minimal flag parser: `--name value` pairs, `--flag` booleans listed in `booleans`, one optional positional. Returns null on misuse. */
function parseFlags(args, { values = [], booleans = [], positional = false } = {}) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { help: true, _: [] };
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (booleans.includes(name)) { out[name] = true; continue; }
      if (!values.includes(name)) return null;
      const value = args[++i];
      if (value === undefined || value.startsWith("--") || out[name] !== undefined) return null;
      out[name] = value;
    } else if (positional && out._.length === 0) {
      out._.push(arg);
    } else {
      return null;
    }
  }
  return out;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function writeNew(path, text, mode) {
  if (await exists(path)) throw new Error(`refusing to overwrite ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, mode === undefined ? undefined : { mode });
}

async function readKeyFile(path) {
  let value;
  try { value = parseProtocolJson(await readFile(path)); }
  catch { throw new Error(`cannot read key file ${path}`); }
  return keyPairFromKeyFile(value, async () => {
    if (process.env[PASSPHRASE_ENV]) return process.env[PASSPHRASE_ENV];
    if (!process.stdin.isTTY) throw new Error(`encrypted key file: set ${PASSPHRASE_ENV} or run interactively`);
    return prompt("Key passphrase: ", { hidden: true });
  });
}

async function prompt(question, { hidden = false, fallback } = {}) {
  if (!process.stdin.isTTY) {
    if (fallback !== undefined) return fallback;
    throw new Error(`non-interactive session: pass the value as a flag (${question.trim()})`);
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    if (!hidden) return (await rl.question(question)).trim();
    // Passphrases are not echoed: print the question once, then silence readline's output.
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    const answer = await rl.question("");
    process.stdout.write("\n");
    return answer.trim();
  } finally {
    rl.close();
  }
}

function keyFileFor(keyPair) {
  const passphrase = process.env[PASSPHRASE_ENV];
  return passphrase ? encryptedKeyFile(keyPair, passphrase) : plainKeyFile(keyPair);
}

async function keygenCommand(args) {
  const flags = parseFlags(args, { values: ["out"] });
  if (!flags) return usageError("keygen", "usage: proofmeta keygen [--out <file>]");
  if (flags.help) { process.stdout.write(USAGE); return 0; }
  const out = resolve(flags.out ?? "proofmeta-key.json");
  const keyPair = await generateKeyPair();
  const file = await keyFileFor(keyPair);
  await writeNew(out, JSON.stringify(file, null, 2) + "\n", 0o600);
  process.stdout.write(`${keyPair.did}\n`);
  process.stderr.write(isEncryptedKeyFile(file)
    ? `key written to ${out} (encrypted with ${PASSPHRASE_ENV})\n`
    : `key written to ${out} (PLAINTEXT — set ${PASSPHRASE_ENV} to encrypt; back it up, anyone holding it can sign as this DID)\n`);
  return 0;
}

async function hashCommand(args) {
  const flags = parseFlags(args, { positional: true });
  if (!flags || (!flags.help && flags._.length !== 1)) return usageError("hash", "usage: proofmeta hash <file>");
  if (flags.help) { process.stdout.write(USAGE); return 0; }
  let bytes;
  try { bytes = await readFile(flags._[0]); } catch { process.stderr.write(`proofmeta hash: cannot read ${flags._[0]}\n`); return 2; }
  process.stdout.write(sha256Ref(bytes) + "\n");
  return 0;
}

async function signCommand(args) {
  const flags = parseFlags(args, { values: ["key", "out", "in-reply-to", "timestamp"], positional: true });
  if (!flags || (!flags.help && (flags._.length !== 1 || !flags.key))) return usageError("sign", "usage: proofmeta sign <payload.json> --key <keyfile> [--out <file>] [--in-reply-to <sha256:…>]");
  if (flags.help) { process.stdout.write(USAGE); return 0; }
  let payload;
  try { payload = parseProtocolJson(await readFile(flags._[0])); } catch { process.stderr.write(`proofmeta sign: cannot read or parse ${flags._[0]}\n`); return 2; }
  let keyPair;
  try { keyPair = await readKeyFile(flags.key); } catch (e) { process.stderr.write(`proofmeta sign: ${e.message}\n`); return 2; }
  let result;
  try { result = await signPayload({ payload, keyPair, inReplyTo: flags["in-reply-to"], timestamp: flags.timestamp }); }
  catch (e) { process.stderr.write(`proofmeta sign: ${e.message}\n`); return 2; }
  const selfCheckFailed = result.report.errors.length > 0;
  if (flags.out) {
    try { await writeNew(resolve(flags.out), result.json); } catch (e) { process.stderr.write(`proofmeta sign: ${e.message}\n`); return 2; }
    process.stderr.write(`envelope written to ${resolve(flags.out)}\n`);
  } else {
    process.stdout.write(result.json);
  }
  if (selfCheckFailed) {
    process.stderr.write(`proofmeta sign: self-check failed: ${result.report.errors.map((e) => `${e.code} at ${e.path || "/"}`).join("; ")}\n`);
    return 1;
  }
  process.stderr.write(payload.type === "manifest" ? "self-check passed (manifest accepted)\n" : "self-check passed (signature, hash and schema; no lifecycle context)\n");
  return 0;
}

async function initCommand(args) {
  const flags = parseFlags(args, { values: ["name", "origin", "preset", "contact", "key", "out", "item-name"], booleans: ["list-presets"] });
  if (!flags) return usageError("init", "usage: proofmeta init [--name <publisher>] [--origin https://example.com] [--preset <id>] [--contact <email|url>] [--key <keyfile>] [--out <dir>]");
  if (flags.help) { process.stdout.write(USAGE); return 0; }
  if (flags["list-presets"]) {
    for (const p of PRESETS) process.stdout.write(`${p.id}\n  ${p.name}: ${p.summary}\n  scope: ${p.scope.join(", ")}\n`);
    return 0;
  }
  const interactive = process.stdin.isTTY;
  try {
    const name = flags.name ?? await prompt("Publisher name (person or organisation): ");
    const origin = flags.origin ?? await prompt("Site origin (https://example.com): ");
    let presetId = flags.preset;
    if (!presetId) {
      if (!interactive) throw new Error("non-interactive session: pass --preset (see --list-presets)");
      process.stdout.write("Policy preset:\n");
      PRESETS.forEach((p, i) => process.stdout.write(`  ${i + 1}) ${p.name} — ${p.summary}\n`));
      const choice = await prompt(`Choose 1-${PRESETS.length}: `);
      presetId = (PRESETS[Number(choice) - 1] ?? presetById(choice))?.id;
      if (!presetId) throw new Error("no such preset");
    }
    const contact = flags.contact ?? (interactive ? await prompt("Contact for requests (email or URL, optional): ") : undefined);
    const outDir = resolve(flags.out ?? "proofmeta-site");
    if (await exists(outDir)) throw new Error(`output directory exists: ${outDir}`);

    let keyPair, generatedKeyPath;
    if (flags.key) keyPair = await readKeyFile(flags.key);
    else {
      keyPair = await generateKeyPair();
      generatedKeyPath = join(outDir, "proofmeta-key.json");
    }

    const policy = await buildPolicy({ keyPair, name, origin, presetId, contact, itemName: flags["item-name"] });
    if (!policy.report.accepted) {
      process.stderr.write(`proofmeta init: self-check failed: ${policy.report.errors.map((e) => `${e.code} at ${e.path || "/"}`).join("; ")}\n`);
      return 1;
    }
    for (const [rel, text] of policy.files) await writeNew(join(outDir, rel), text);
    if (generatedKeyPath) await writeNew(generatedKeyPath, JSON.stringify(await keyFileFor(keyPair), null, 2) + "\n", 0o600);
    await writeNew(join(outDir, "README.txt"), policy.readme(generatedKeyPath ? "proofmeta-key.json" : flags.key));

    process.stdout.write([
      `Signed manifest for ${policy.origin} written to ${outDir}`,
      `  identity   ${keyPair.did}`,
      `  preset     ${policy.preset.name} [${policy.preset.scope.join(", ")}]`,
      `  upload     .well-known/proofmeta.json, ${[...policy.files.keys()][1]}, requests.html`,
      generatedKeyPath
        ? `  key        proofmeta-key.json — ${process.env[PASSPHRASE_ENV] ? "encrypted" : "PLAINTEXT, keep it private"}; do not upload it`
        : `  key        ${flags.key}`,
      `  next       see README.txt, then: proofmeta fetch ${policy.origin}`,
      "",
    ].join("\n"));
    return 0;
  } catch (e) {
    process.stderr.write(`proofmeta init: ${e.message}\n`);
    return 2;
  }
}

async function fetchCommand(args, deps = {}) {
  const flags = parseFlags(args, { booleans: ["json"], positional: true });
  if (!flags || (!flags.help && flags._.length !== 1)) return usageError("fetch", "usage: proofmeta fetch <domain|url> [--json]");
  if (flags.help) { process.stdout.write(USAGE); return 0; }
  let url, fetched;
  try {
    url = resolveManifestUrl(flags._[0]);
    fetched = await fetchManifestBytes(url, deps);
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message;
    process.stderr.write(`proofmeta fetch: ${e.name === "AbortError" ? "timed out" : e.message}${cause ? ` (${cause})` : ""}\n`);
    return 2;
  }
  const report = await acceptManifestBytes(fetched.bytes);
  if (flags.json) process.stdout.write(JSON.stringify({ url: fetched.finalUrl, ...report }, null, 2) + "\n");
  else process.stdout.write(formatManifestSummary(report, fetched.finalUrl));
  return report.accepted ? 0 : 1;
}

function usageError(command, text) {
  process.stderr.write(`proofmeta ${command}: ${text}\n`);
  return 2;
}

async function acceptCommand(args) {
  let file, operation, purpose, contextFile;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--operation' || arg === '--purpose' || arg === '--context') {
      const value = args[++i];
      if (!value || value.startsWith('--') || (arg === '--operation' ? operation : arg === '--purpose' ? purpose : contextFile) !== undefined) return 2;
      if (arg === '--operation') operation = value; else if (arg === '--purpose') purpose = value; else contextFile = value;
    } else if (arg === '--json') { /* Acceptance reports are always JSON. */ }
    else if (arg.startsWith('-') || file !== undefined) return 2;
    else file = arg;
  }
  if (!file || !['manifest','provider-open','license-chain','attestation-root','attestation-chain','inspect-envelope'].includes(operation)
    || (operation === 'inspect-envelope' ? purpose !== 'inspection' : purpose !== 'protocol-conformance' && !(operation === 'license-chain' && purpose === 'consumer-response'))) {
    process.stderr.write('proofmeta accept: explicit valid --operation and --purpose required\n');
    return 2;
  }
  let bytes;
  try { bytes = await readFile(file); }
  catch { process.stderr.write('proofmeta accept: cannot read source file\n'); return 2; }
  let evidence = {};
  if (contextFile !== undefined) {
    try { evidence = parseProtocolJson(await readFile(contextFile)); }
    catch { process.stderr.write('proofmeta accept: invalid or unreadable context file\n'); return 2; }
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      || ('operation' in evidence && evidence.operation !== operation)
      || ('purpose' in evidence && evidence.purpose !== purpose) || 'resolveAuthor' in evidence) {
      process.stderr.write('proofmeta accept: invalid context configuration\n'); return 2;
    }
  }
  const report = await acceptProtocolInput({ kind: 'bytes', bytes }, { ...evidence, operation, purpose });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.accepted ? 0 : 1;
}

const { version: CLI_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

const USAGE = `proofmeta — ProofMeta reference CLI

Publish:
  proofmeta init [--name <publisher>] [--origin <https://example.com>] [--preset <id>]
                 [--contact <email|url>] [--key <keyfile>] [--out <dir>] [--item-name <text>]
                                    Create a signed policy: manifest, terms text, requests page,
                                    hosting notes. Prompts for missing values on a terminal.
  proofmeta init --list-presets     Show the available policy presets.
  proofmeta keygen [--out <file>]    Create an ed25519 key and print its did:key.
  proofmeta hash <file>              Print sha256:<hex> of a file (terms_hash, content_hash).
  proofmeta sign <payload.json> --key <keyfile> [--out <file>] [--in-reply-to <sha256:…>]
                                    Wrap a payload in a Signed Envelope and self-check it.

Read:
  proofmeta fetch <domain|url> [--json]
                                    GET /.well-known/proofmeta.json, accept it as a manifest,
                                    print who signed what under which scope.

Check:
  proofmeta accept <file> --operation <op> --purpose <purpose> [--context <file>]
                                    Emit SDK AcceptanceReport JSON; inspection never accepted.
  proofmeta validate <file>          Conformance diagnostics only (accepted=false).
  proofmeta validate <file> --json   Emit compatibility keys plus SDK checks/errors/guarantees.
  proofmeta --help                   Show this help.
  proofmeta --version                Print the CLI version.

Key files are JSON; set ${PASSPHRASE_ENV} to write and read them encrypted
(PBKDF2-SHA256 + AES-256-GCM, same format as the browser generator's backup).

Input file for accept/validate may contain:
  - a single envelope object, OR
  - an array of envelopes (treated as a chain in the given order).

The validator checks:
  1. JSON Schema compliance (envelope + payload shape for known payload types).
  2. payload_hash matches sha256(JCS(payload)).
  3. Ed25519 signature over the UTF-8 JCS envelope signing projection and core actor authority.
  4. For arrays: in_reply_to integrity, request_id consistency, and license Provider authority.
`;

export async function main(argv, deps = {}) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`proofmeta ${CLI_VERSION}\n`);
    return 0;
  }

  if (argv[0] === 'accept') return acceptCommand(argv.slice(1));
  if (argv[0] === 'init') return initCommand(argv.slice(1));
  if (argv[0] === 'keygen') return keygenCommand(argv.slice(1));
  if (argv[0] === 'hash') return hashCommand(argv.slice(1));
  if (argv[0] === 'sign') return signCommand(argv.slice(1));
  if (argv[0] === 'fetch') return fetchCommand(argv.slice(1), deps);
  if (argv[0] !== "validate") {
    process.stderr.write(`proofmeta: unknown command: ${argv[0]}\n\n`);
    process.stderr.write(USAGE);
    return 2;
  }

  const rest = argv.slice(1);
  let file;
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      return 0;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`proofmeta validate: unknown flag: ${arg}\n`);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      process.stderr.write(`proofmeta validate: unexpected argument: ${arg}\n`);
      return 2;
    }
  }

  if (file === undefined) {
    process.stderr.write("proofmeta validate: missing <file> argument\n");
    return 2;
  }

  let raw;
  try {
    raw = await readFile(file);
  } catch (err) {
    process.stderr.write(`proofmeta validate: cannot read ${file}: ${err.message}\n`);
    return 2;
  }

  const report = await validateBytes(raw);
  if (report.errors?.[0]?.code === 'JSON_SYNTAX') {
    process.stderr.write('proofmeta validate: JSON_SYNTAX\n');
    return 2;
  }

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(report, file));
  }

  return report.ok ? 0 : 1;
}
