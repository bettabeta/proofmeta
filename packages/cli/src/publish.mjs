// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Publisher-side helpers behind `proofmeta init`, `sign` and `hash`. Pure:
 * no filesystem or terminal access, so tests can drive them directly.
 */

import { createHash } from "node:crypto";
import { createEnvelope } from "@proofmeta/sdk-ts";
import { acceptProtocolInput } from "@proofmeta/sdk-ts/acceptance";
import { presetById, termsText, requestsHtml, hostingReadme } from "./presets.mjs";

export function sha256Ref(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

/** Accepts `https://example.com` or `https://example.com/`; rejects paths, queries, credentials and non-http schemes. */
export function normalizeOrigin(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error("origin must be an absolute URL such as https://example.com"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("origin must use https:// (or http:// for local testing)");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("origin must be scheme and host only, without path, query or credentials");
  }
  return url.origin;
}

export function normalizeContact(input) {
  if (input === undefined || input === null || String(input).trim() === "") return undefined;
  const raw = String(input).trim();
  const candidate = /^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(raw) ? `mailto:${raw}` : raw;
  let url;
  try { url = new URL(candidate); } catch { throw new Error("contact must be an email address or an absolute URL"); }
  if (!["mailto:", "https:", "http:"].includes(url.protocol)) throw new Error("contact must be mailto:, https:// or http://");
  return url.href;
}

/**
 * Builds every file a publisher hosts for one preset. Returns the signed
 * manifest, the SDK acceptance report of the self-check and a path → text map.
 * Throws when the preset is unknown; a failed self-check is returned, not thrown.
 */
export async function buildPolicy({ keyPair, name, origin, presetId, contact, itemName, date, timestamp }) {
  const preset = presetById(presetId);
  if (!preset) throw new Error(`unknown preset: ${presetId}`);
  const publisher = String(name ?? "").trim();
  if (!publisher) throw new Error("publisher name is required");
  const site = normalizeOrigin(origin);
  const contactHref = normalizeContact(contact);
  const version = date ?? new Date().toISOString().slice(0, 10);

  const licenseId = preset.id;
  const termsPath = `.well-known/proofmeta-terms/${licenseId}.txt`;
  const terms = termsText({ preset, publisher, origin: site, date: version });
  const termsUrl = `${site}/${termsPath}`;
  const requestEndpoint = `${site}/requests.html`;

  const payload = {
    type: "manifest",
    provider: { id: keyPair.did, name: publisher },
    request_endpoint: requestEndpoint,
    items: [
      {
        item_id: "site-content",
        name: String(itemName ?? "").trim() || `Content published at ${site}`,
        description: `Everything ${publisher} publishes at ${site}, unless an item states otherwise.`,
        available_licenses: [licenseId],
      },
    ],
    license_types: [
      {
        id: licenseId,
        name: preset.name,
        terms_url: termsUrl,
        terms_hash: sha256Ref(new TextEncoder().encode(terms)),
        scope: [...preset.scope],
      },
    ],
  };

  const manifest = await createEnvelope({ payload, author: keyPair.did, privateKey: keyPair.privateKey, ...(timestamp ? { timestamp } : {}) });
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  const report = await acceptProtocolInput(
    { kind: "bytes", bytes: new TextEncoder().encode(manifestJson) },
    { operation: "manifest", purpose: "protocol-conformance" },
  );

  const files = new Map([
    [".well-known/proofmeta.json", manifestJson],
    [termsPath, terms],
    ["requests.html", requestsHtml({ publisher, origin: site, preset, contact: contactHref, termsUrl })],
  ]);
  return { manifest, report, files, preset, origin: site, licenseId, termsUrl, requestEndpoint, readme: (keyFile) => hostingReadme({ origin: site, licenseId, keyFile }) };
}

/** Wraps a payload in a Signed Envelope and self-checks it; manifests go through full acceptance, anything else through inspection. */
export async function signPayload({ payload, keyPair, inReplyTo, timestamp }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.type !== "string") {
    throw new Error("payload must be a JSON object with a string `type`");
  }
  const envelope = await createEnvelope({
    payload, author: keyPair.did, privateKey: keyPair.privateKey,
    ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
    ...(timestamp ? { timestamp } : {}),
  });
  const json = JSON.stringify(envelope, null, 2) + "\n";
  const context = payload.type === "manifest"
    ? { operation: "manifest", purpose: "protocol-conformance" }
    : { operation: "inspect-envelope", purpose: "inspection" };
  const report = await acceptProtocolInput({ kind: "bytes", bytes: new TextEncoder().encode(json) }, context);
  return { envelope, json, report };
}
