// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Transport only: turns a URL or domain into raw response bytes.
 * No parsing, no protocol checks — those belong to @proofmeta/sdk-ts.
 */

export const WELL_KNOWN_PATH = "/.well-known/proofmeta.json";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_048_576;

export type TransportCode =
  | "URL_INVALID"
  | "SCHEME_UNSUPPORTED"
  | "URL_CREDENTIALS"
  | "DOMAIN_INVALID"
  | "REDIRECT_NOT_FOLLOWED"
  | "HTTP_STATUS"
  | "BODY_TOO_LARGE"
  | "TIMEOUT"
  | "FETCH_FAILED";

export interface TransportError {
  code: TransportCode;
  detail: string;
  status?: number;
  location?: string;
}

export interface TransportOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Permit plain `http:` for loopback hosts only (local development / smoke tests). */
  allowHttpLoopback?: boolean;
  fetch?: typeof globalThis.fetch;
}

export type FetchOutcome =
  | { ok: true; url: string; status: number; contentType: string | null; bytes: Uint8Array }
  | { ok: false; url: string; error: TransportError };

// WHATWG URL parsing silently trims/strips these; reject instead of normalising.
const WHITESPACE_OR_CONTROL = /[\u0000-\u0020\u007f-\u009f]/;
const LDH_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function fail(url: string, error: TransportError): FetchOutcome {
  return { ok: false, url, error };
}

export function parseManifestUrl(
  input: string,
  opts: Pick<TransportOptions, "allowHttpLoopback"> = {},
): { ok: true; url: URL } | { ok: false; error: TransportError } {
  if (typeof input !== "string" || input.length === 0 || WHITESPACE_OR_CONTROL.test(input)) {
    return {
      ok: false,
      error: { code: "URL_INVALID", detail: "URL is empty or contains whitespace/control characters" },
    };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: { code: "URL_INVALID", detail: "not an absolute URL" } };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, error: { code: "URL_CREDENTIALS", detail: "URLs with embedded credentials are rejected" } };
  }
  const httpLoopback = opts.allowHttpLoopback === true && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !httpLoopback) {
    return {
      ok: false,
      error: {
        code: "SCHEME_UNSUPPORTED",
        detail: `scheme ${url.protocol} is not fetched by this server; only https: is supported`,
      },
    };
  }
  return { ok: true, url };
}

export function wellKnownUrl(domain: string): { ok: true; url: URL } | { ok: false; error: TransportError } {
  const invalid = (detail: string) => ({ ok: false as const, error: { code: "DOMAIN_INVALID" as const, detail } });
  if (typeof domain !== "string" || domain.length === 0 || domain.length > 253 || WHITESPACE_OR_CONTROL.test(domain)) {
    return invalid("domain is empty, too long, or contains whitespace/control characters");
  }
  if (/[/\\:@?#[\]%]/.test(domain)) {
    return invalid("expected a bare domain name without scheme, port, path, query, or credentials");
  }
  let url: URL;
  try {
    url = new URL(`https://${domain}${WELL_KNOWN_PATH}`);
  } catch {
    return invalid("not a valid domain name");
  }
  const labels = url.hostname.split(".");
  if (labels.length < 2 || !labels.every((l) => LDH_LABEL.test(l)) || /^[0-9]+$/.test(labels[labels.length - 1])) {
    return invalid("not a fully qualified DNS domain name (IP literals and single labels are rejected)");
  }
  return { ok: true, url };
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** One GET, no redirects, bounded time and size. Body bytes are returned untouched. */
export async function fetchManifestBytes(url: URL, opts: TransportOptions = {}): Promise<FetchOutcome> {
  const href = url.href;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = opts.fetch ?? globalThis.fetch;
  try {
    const res = await doFetch(href, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get("location") ?? undefined;
      return fail(href, {
        code: "REDIRECT_NOT_FOLLOWED",
        detail: "redirects are not followed; verify the target URL explicitly if it is trusted",
        status: res.status,
        ...(location === undefined ? {} : { location }),
      });
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(href, { code: "HTTP_STATUS", detail: `expected HTTP 200, got ${res.status}`, status: res.status });
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return fail(href, { code: "BODY_TOO_LARGE", detail: `body exceeds ${maxBytes} bytes`, status: res.status });
    }
    const bytes = await readLimited(res, maxBytes);
    if (bytes === null) {
      return fail(href, { code: "BODY_TOO_LARGE", detail: `body exceeds ${maxBytes} bytes`, status: res.status });
    }
    return { ok: true, url: href, status: res.status, contentType: res.headers.get("content-type"), bytes };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return fail(href, { code: "TIMEOUT", detail: `no complete response within ${timeoutMs} ms` });
    }
    return fail(href, { code: "FETCH_FAILED", detail: e instanceof Error ? e.message : "fetch failed" });
  }
}
