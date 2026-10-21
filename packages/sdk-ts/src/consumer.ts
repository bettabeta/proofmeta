// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import {
  acceptProtocolInput,
  JsonIngressError,
  parseProtocolJson,
} from "./acceptance.js";
import { createEnvelope, verifyChain } from "./envelope.js";
import type { KeyPair } from "./keys.js";
import type {
  AnyPayload,
  Envelope,
  LicenseRequestPayload,
  ManifestEnvelope,
  StatusUpdateEnvelope,
} from "./types.js";

export interface RequestLicenseOptions {
  manifestUrl: string;
  itemId: string;
  licenseType: string;
  keyPair: KeyPair;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export type LicenseChain = [
  Envelope<LicenseRequestPayload>,
  ...StatusUpdateEnvelope[],
];

export type RequestLicenseResult =
  | { ok: true; status: "GRANTED"; chain: LicenseChain }
  | { ok: false; reason: string };

const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

/**
 * Fetch an accepted Manifest, submit a signed OPEN request, and poll until the
 * Provider returns a verified terminal license chain.
 */
export async function requestLicense(
  options: RequestLicenseOptions,
): Promise<RequestLicenseResult> {
  try {
    const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 0) {
      return failure("pollTimeoutMs must be a non-negative finite number");
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      return failure("pollIntervalMs must be a non-negative finite number");
    }
    if (typeof globalThis.fetch !== "function") {
      return failure("network error: fetch is unavailable");
    }

    const manifestResponse = await networkFetch(
      options.manifestUrl,
      undefined,
      "fetching manifest",
    );
    if (!manifestResponse.ok) return manifestResponse;
    if (!manifestResponse.response.ok) {
      return failure(`manifest HTTP ${manifestResponse.response.status}`);
    }

    const manifestBody = await networkBytes(
      manifestResponse.response,
      "reading manifest",
    );
    if (!manifestBody.ok) return manifestBody;
    const manifestReport = await acceptProtocolInput(
      { kind: "bytes", bytes: manifestBody.bytes },
      { operation: "manifest", purpose: "protocol-conformance" },
    );
    if (!manifestReport.accepted) {
      return failure(
        `manifest acceptance failed: ${manifestReport.errors[0]?.code ?? "unknown"}`,
      );
    }
    const manifestEnvelope =
      manifestReport.snapshot as unknown as ManifestEnvelope;
    const manifest = manifestEnvelope.payload;
    const item = manifest.items?.find(
      (candidate) => candidate.item_id === options.itemId,
    );
    if (!item) {
      return failure(
        `manifest does not contain inline item "${options.itemId}"`,
      );
    }
    if (!item.available_licenses.includes(options.licenseType)) {
      return failure(
        `item "${options.itemId}" does not offer license "${options.licenseType}"`,
      );
    }
    const licenseType = manifest.license_types.find(
      (candidate) => candidate.id === options.licenseType,
    );
    if (!licenseType) {
      return failure(
        `manifest does not define license "${options.licenseType}"`,
      );
    }

    const requestId = uuidv7();
    const openEnvelope = await createEnvelope({
      payload: {
        type: "license.request",
        request_id: requestId,
        consumer: { id: options.keyPair.did },
        provider_id: manifest.provider.id,
        item_id: item.item_id,
        license_type: licenseType.id,
        terms_hash: licenseType.terms_hash,
        status: "OPEN",
      },
      author: options.keyPair.did,
      privateKey: options.keyPair.privateKey,
    });

    const postResponse = await networkFetch(
      manifest.request_endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(openEnvelope),
      },
      "submitting license request",
    );
    if (!postResponse.ok) return postResponse;
    if (!postResponse.response.ok) {
      return failure(`license request HTTP ${postResponse.response.status}`);
    }

    const context = {
      operation: "license-chain" as const,
      purpose: "consumer-response" as const,
      sentOpen: openEnvelope,
      expectedProvider: manifest.provider.id,
      manifest: manifestEnvelope,
      item,
      licenseType: licenseType.id,
      termsHash: licenseType.terms_hash,
    };
    const postBody = await networkBytes(
      postResponse.response,
      "reading license response",
    );
    if (!postBody.ok) return postBody;
    const postedChain = readChainWrapper(postBody.bytes);
    if (!postedChain.ok) return postedChain;
    const initial = await acceptChain(postedChain.value, context);
    if (!initial.ok) return initial;

    const deadline = Date.now() + pollTimeoutMs;
    const statusUrl = new URL(manifest.request_endpoint);
    statusUrl.pathname = `${statusUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(requestId)}`;
    let acceptedChain = initial.chain;
    while (true) {
      const statusResponse = await networkFetch(
        statusUrl.href,
        undefined,
        "polling license status",
      );
      if (!statusResponse.ok) return statusResponse;
      if (!statusResponse.response.ok) {
        return failure(
          `license status HTTP ${statusResponse.response.status}`,
        );
      }

      const statusBody = await networkBytes(
        statusResponse.response,
        "reading license status",
      );
      if (!statusBody.ok) return statusBody;
      const latest = readEnvelope(statusBody.bytes);
      if (!latest.ok) return latest;
      const previousHead = acceptedChain.at(-1);
      const candidate = sameSignedEnvelope(previousHead, latest.value)
        ? [...acceptedChain.slice(0, -1), latest.value]
        : [...acceptedChain, latest.value];
      const followed = await acceptChain(candidate, context);
      if (!followed.ok) return followed;
      acceptedChain = followed.chain;

      const status = acceptedChain.at(-1)?.payload.status;
      if (status === "GRANTED") {
        return { ok: true, status, chain: acceptedChain };
      }
      if (
        status === "DENIED" ||
        status === "SUSPENDED" ||
        status === "REVOKED"
      ) {
        return failure(`provider returned ${status}`);
      }
      if (Date.now() >= deadline) {
        return failure("poll timeout waiting for a terminal license status");
      }
      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
  } catch (error) {
    return failure(
      `license request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function acceptChain(
  value: unknown,
  context: Parameters<typeof acceptProtocolInput>[1],
): Promise<
  | { ok: true; chain: LicenseChain }
  | { ok: false; reason: string }
> {
  const acceptance = await acceptProtocolInput(
    { kind: "value", value },
    context,
  );
  if (!acceptance.accepted) {
    return failure(
      `license chain acceptance failed: ${acceptance.errors[0]?.code ?? "unknown"}`,
    );
  }
  const chain = acceptance.snapshot as unknown as LicenseChain;
  const verification = await verifyChain(chain as Envelope<AnyPayload>[]);
  if (!verification.ok) {
    return failure(
      `license chain verification failed: ${verification.reason}`,
    );
  }
  return { ok: true, chain };
}

function sameSignedEnvelope(
  left: Envelope<AnyPayload> | undefined,
  right: unknown,
): boolean {
  if (!left || !right || typeof right !== "object" || Array.isArray(right)) {
    return false;
  }
  const candidate = right as Record<string, unknown>;
  return [
    "proofmeta",
    "payload_hash",
    "author",
    "timestamp",
    "in_reply_to",
    "signature",
  ].every((key) => candidate[key] === left[key as keyof typeof left]);
}

type NetworkResult =
  | { ok: true; response: Response }
  | { ok: false; reason: string };

async function networkFetch(
  input: string,
  init: RequestInit | undefined,
  action: string,
): Promise<NetworkResult> {
  try {
    return { ok: true, response: await globalThis.fetch(input, init) };
  } catch {
    return failure(`network error while ${action}`);
  }
}

async function networkBytes(
  response: Response,
  action: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  try {
    return {
      ok: true,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  } catch {
    return failure(`network error while ${action}`);
  }
}

function readChainWrapper(
  bytes: Uint8Array,
): { ok: true; value: unknown[] } | { ok: false; reason: string } {
  try {
    const wrapper = parseProtocolJson(bytes);
    if (
      !wrapper ||
      typeof wrapper !== "object" ||
      Array.isArray(wrapper) ||
      !Array.isArray(wrapper.chain)
    ) {
      return failure("provider returned an invalid license chain wrapper");
    }
    return { ok: true, value: wrapper.chain };
  } catch (error) {
    if (error instanceof JsonIngressError) {
      return failure(`license chain response failed: ${error.code}`);
    }
    return failure("provider returned malformed license chain JSON");
  }
}

function readEnvelope(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: parseProtocolJson(bytes) };
  } catch (error) {
    if (error instanceof JsonIngressError) {
      return failure(`license status response failed: ${error.code}`);
    }
    return failure("provider returned malformed license status JSON");
  }
}

function uuidv7(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = globalThis.crypto.getRandomValues(new Uint8Array(10));
  random[0] = (random[0] & 0x0f) | 0x70;
  random[2] = (random[2] & 0x3f) | 0x80;
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function failure(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
