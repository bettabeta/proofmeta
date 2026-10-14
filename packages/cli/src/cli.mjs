// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Argv parsing for the `proofmeta` CLI. Keep this file dumb — actual
 * validation logic lives in src/validate.mjs so tests can exercise it
 * without spawning a subprocess.
 */

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { validateBytes, formatReport } from "./validate.mjs";
import { acceptProtocolInput, parseProtocolJson } from '@proofmeta/sdk-ts/acceptance';

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

const USAGE = `proofmeta — ProofMeta reference validator

Usage:
  proofmeta accept <file> --operation <op> --purpose <purpose> [--context <file>]
                                    Emit SDK AcceptanceReport JSON; inspection never accepted.
  proofmeta validate <file>          Konformitätsdiagnostik only (accepted=false).
  proofmeta validate <file> --json   Emit compatibility keys plus SDK checks/errors/guarantees.
  proofmeta --help                   Show this help.
  proofmeta --version                Print the CLI version.

Input file may contain:
  - a single envelope object, OR
  - an array of envelopes (treated as a chain in the given order).

The validator checks:
  1. JSON Schema compliance (envelope + payload shape for known payload types).
  2. payload_hash matches sha256(JCS(payload)).
  3. Ed25519 signature over the UTF-8 JCS envelope signing projection and core actor authority.
  4. For arrays: in_reply_to integrity, request_id consistency, and license Provider authority.
`;

export async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`proofmeta ${CLI_VERSION}\n`);
    return 0;
  }

  if (argv[0] === 'accept') return acceptCommand(argv.slice(1));
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
