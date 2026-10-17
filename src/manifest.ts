// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { acceptProtocolInput, type AcceptanceReport, type JsonValue } from "@proofmeta/sdk-ts/acceptance";
import {
  fetchManifestBytes,
  parseManifestUrl,
  wellKnownUrl,
  type TransportError,
  type TransportOptions,
} from "./transport.js";

export type ManifestReport = Omit<AcceptanceReport, "snapshot">;

export interface ManifestResult {
  /** True only if transport succeeded and the SDK accepted the bytes as a manifest. */
  accepted: boolean;
  url: string;
  transport:
    | { ok: true; status: number; contentType: string | null; bytes: number }
    | ({ ok: false } & TransportError)
    | { ok: false; code: "INTERNAL_ERROR"; detail: string };
  /** SDK acceptance report (`@proofmeta/sdk-ts/acceptance`), present whenever bytes reached the SDK. */
  report?: ManifestReport;
  /** The accepted manifest envelope. Never present when `accepted` is false. */
  manifest?: JsonValue;
}

export interface DiscoveryResult extends ManifestResult {
  domain: string;
}

async function acceptFetched(url: URL, opts: TransportOptions): Promise<ManifestResult> {
  const fetched = await fetchManifestBytes(url, opts);
  if (!fetched.ok) {
    return { accepted: false, url: fetched.url, transport: { ok: false, ...fetched.error } };
  }
  const transport = {
    ok: true as const,
    status: fetched.status,
    contentType: fetched.contentType,
    bytes: fetched.bytes.byteLength,
  };
  const full = await acceptProtocolInput(
    { kind: "bytes", bytes: fetched.bytes },
    { operation: "manifest", purpose: "protocol-conformance" },
  );
  const { snapshot, ...report } = full;
  const accepted = full.accepted === true && full.operation === "manifest" && full.errors.length === 0;
  return {
    accepted,
    url: fetched.url,
    transport,
    report,
    ...(accepted && snapshot !== undefined ? { manifest: snapshot } : {}),
  };
}

function internalError(url: string, e: unknown): ManifestResult {
  return {
    accepted: false,
    url,
    transport: { ok: false, code: "INTERNAL_ERROR", detail: e instanceof Error ? e.message : "unexpected error" },
  };
}

export async function verifyManifest(input: string, opts: TransportOptions = {}): Promise<ManifestResult> {
  const parsed = parseManifestUrl(input, opts);
  if (!parsed.ok) return { accepted: false, url: String(input), transport: { ok: false, ...parsed.error } };
  try {
    return await acceptFetched(parsed.url, opts);
  } catch (e) {
    return internalError(parsed.url.href, e);
  }
}

export async function discoverManifest(domain: string, opts: TransportOptions = {}): Promise<DiscoveryResult> {
  const target = wellKnownUrl(domain);
  if (!target.ok)
    return { domain: String(domain), accepted: false, url: "", transport: { ok: false, ...target.error } };
  try {
    return { domain, ...(await acceptFetched(target.url, opts)) };
  } catch (e) {
    return { domain, ...internalError(target.url.href, e) };
  }
}
