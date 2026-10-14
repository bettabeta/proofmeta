// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Core validation logic. Kept independent of argv parsing so tests can
 * drive it directly with parsed JSON values.
 *
 * Report shape:
 *   {
 *     ok: boolean,
 *     kind: "envelope" | "chain",
 *     envelopes: Array<EnvelopeReport>,
 *     chain?: { ok: boolean, reason?: string },
 *     transitions?: { ok: boolean, reason?: string },
 *   }
 *
 * Each envelope report:
 *   {
 *     index: number,
 *     ok: boolean,
 *     payload_type?: string,
 *     schema: { ok: boolean, errors: string[] },
 *     hash:   { ok: boolean, reason?: string },
 *     signature: { ok: boolean, reason?: string },
 *   }
 *
 * We recompute the hash and verify the signature via the SDK so this tool
 * and the reference SDK agree on what "valid" means.
 */

import { acceptProtocolInput } from '@proofmeta/sdk-ts/acceptance';
export async function validateBytes(bytes) {
  return validateSource({ kind: 'bytes', bytes });
}

const inspection = { operation: 'inspect-envelope', purpose: 'inspection' };
const passed = checks => !Object.values(checks).includes('fail');
function reason(report) {
  return report.errors.map(e => `${e.code} ${e.path}`).join('; ') || 'not-checked';
}
function operationFor(input) {
  const root = Array.isArray(input) ? input[0] : input;
  const p = root?.payload;
  const modeB = p?.type === 'status.update' && p.request_id === undefined && p.subject !== undefined && p.policy !== undefined;
  if (Array.isArray(input)) return modeB ? 'attestation-chain' : 'license-chain';
  return p?.type === 'manifest' ? 'manifest' : modeB ? 'attestation-root' : 'inspect-envelope';
}
async function validateOne(value, index) {
  const r = await acceptProtocolInput({ kind: 'value', value }, inspection);
  const check = name => ({ ok: r.checks[name] === 'pass', ...(r.checks[name] === 'pass' ? {} : { reason: reason(r) }) });
  return { index, ok: passed(r.checks), payload_type: typeof value?.payload?.type === 'string' ? value.payload.type : undefined,
    schema: { ok: r.checks.schema === 'pass', errors: r.checks.schema === 'pass' ? [] : [reason(r)] },
    hash: check('hash'), signature: check('signature') };
}
async function adapt(result) {
  const value = result.snapshot;
  const isChain = Array.isArray(value);
  const envelopes = result.checks.ingress === 'fail' ? [] : await Promise.all((isChain ? value : [value]).map(validateOne));
  const report = { ...result, ok: result.operation === 'inspect-envelope' ? passed(result.checks) : result.accepted,
    accepted: false, kind: isChain ? 'chain' : 'envelope', envelopes };
  if (isChain) {
    const diagnostic = reason(result).replace('PARENT_MISMATCH', 'PARENT_MISMATCH in_reply_to');
    report.chain = report.ok ? { ok: true } : { ok: false, reason: diagnostic };
    report.transitions = report.ok ? { ok: true } : { ok: false, reason: diagnostic };
  }
  return report;
}
async function validateSource(source) {
  const ingress = await acceptProtocolInput(source, inspection);
  if (ingress.checks.ingress === 'fail') return adapt(ingress);
  const operation = operationFor(ingress.snapshot);
  return adapt(operation === 'inspect-envelope' ? ingress : await acceptProtocolInput(source, { operation, purpose: 'protocol-conformance' }));
}

/**
 * Validate either a single envelope object or an array of envelopes (chain).
 */
export async function validateInput(input) {
  return validateSource({ kind: 'value', value: input });
}

// ── Human-readable formatter ────────────────────────────────────────────

export function formatReport(report, filename) {
  const lines = [];
  const header = report.kind === "chain" ? "chain" : "envelope";
  lines.push(`proofmeta validate ${filename} — ${header} (${report.envelopes.length} envelope${report.envelopes.length === 1 ? "" : "s"})`);

  for (const r of report.envelopes) {
    const label = report.kind === "chain" ? `envelope[${r.index}]` : "envelope";
    const typeLabel = r.payload_type ? ` payload.type=${r.payload_type}` : "";
    lines.push(`  ${mark(r.ok)} ${label}${typeLabel}`);
    lines.push(`    ${mark(r.schema.ok)} schema`);
    for (const err of r.schema.errors) {
      lines.push(`        · ${err}`);
    }
    lines.push(`    ${mark(r.hash.ok)} payload_hash`);
    if (!r.hash.ok && r.hash.reason) lines.push(`        · ${r.hash.reason}`);
    lines.push(`    ${mark(r.signature.ok)} signature`);
    if (!r.signature.ok && r.signature.reason) lines.push(`        · ${r.signature.reason}`);
  }

  if (report.chain) {
    lines.push(`  ${mark(report.chain.ok)} chain integrity`);
    if (!report.chain.ok && report.chain.reason) {
      lines.push(`        · ${report.chain.reason}`);
    }
  }

  if (report.transitions) {
    lines.push(`  ${mark(report.transitions.ok)} status transitions`);
    if (!report.transitions.ok && report.transitions.reason) {
      lines.push(`        · ${report.transitions.reason}`);
    }
  }

  for (const error of report.errors ?? []) lines.push(`  ${error.code} ${error.path}`);
  lines.push("");
  lines.push(report.ok ? "OK (diagnostic only; accepted=false; no operational authorization)" : "FAIL (accepted=false)");
  return lines.join("\n") + "\n";
}

function mark(ok) {
  return ok ? "[OK]  " : "[FAIL]";
}
