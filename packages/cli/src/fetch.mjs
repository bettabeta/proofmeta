// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * `proofmeta fetch`: discovery (SPEC §3.7) plus manifest acceptance, with a
 * human summary. The network step is injectable so tests run against a
 * loopback server and never leave the machine.
 */

import { acceptProtocolInput } from "@proofmeta/sdk-ts/acceptance";
import { SCOPE_MEANING } from "./presets.mjs";

export const MAX_MANIFEST_BYTES = 1024 * 1024;

/** `example.com` → `https://example.com/.well-known/proofmeta.json`; an explicit URL is used as given, with the well-known path appended when it has none. */
export function resolveManifestUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("domain or URL required");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { throw new Error(`not a domain or URL: ${raw}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) manifests can be fetched");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/.well-known/proofmeta.json";
  return url.href;
}

export async function fetchManifestBytes(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = MAX_MANIFEST_BYTES } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`manifest larger than ${maxBytes} bytes`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`manifest larger than ${maxBytes} bytes`);
    return { bytes: buf, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export async function acceptManifestBytes(bytes) {
  return acceptProtocolInput({ kind: "bytes", bytes }, { operation: "manifest", purpose: "protocol-conformance" });
}

export function describeScope(tag) {
  return SCOPE_MEANING[tag] ? `${tag} (${SCOPE_MEANING[tag]})` : `${tag} (extension, see URL)`;
}

/** Human summary of an accepted or rejected manifest report. */
export function formatManifestSummary(report, url) {
  const lines = [`proofmeta fetch ${url}`];
  if (!report.accepted) {
    lines.push(`  REJECTED — ${report.errors.map((e) => `${e.code} at ${e.path || "/"}`).join("; ") || "not accepted"}`);
    lines.push("  Nothing in this file can be relied on.");
    return lines.join("\n") + "\n";
  }
  const env = report.snapshot;
  const p = env.payload;
  lines.push("  VALID MANIFEST — signature, hash, schema and scope verified");
  lines.push(`  provider   ${p.provider.name ? `${p.provider.name} — ` : ""}${p.provider.id}`);
  lines.push(`  signed at  ${env.timestamp}`);
  lines.push(`  requests   ${p.request_endpoint}`);
  if (p.catalog_endpoint) lines.push(`  catalog    ${p.catalog_endpoint}`);
  for (const lt of p.license_types) {
    lines.push("");
    lines.push(`  license    ${lt.id}${lt.name ? ` · ${lt.name}` : ""}${lt.price_hint ? ` · ${lt.price_hint.amount} ${lt.price_hint.currency}` : ""}`);
    lines.push(`    terms    ${lt.terms_url}`);
    for (const tag of lt.scope) lines.push(`    - ${describeScope(tag)}`);
  }
  if (Array.isArray(p.items)) {
    lines.push("");
    lines.push(`  items      ${p.items.length}`);
    for (const item of p.items.slice(0, 20)) lines.push(`    - ${item.item_id}: ${item.name} [${item.available_licenses.join(", ")}]`);
    if (p.items.length > 20) lines.push(`    … ${p.items.length - 20} more`);
  }
  lines.push("");
  lines.push("  Verified: who signed, what was signed, scope tags. Not verified: terms text, delivery, payment, legal effect.");
  return lines.join("\n") + "\n";
}
