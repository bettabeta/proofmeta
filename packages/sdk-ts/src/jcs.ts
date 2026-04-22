// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * JCS (JSON Canonicalization Scheme, RFC 8785) implementation.
 *
 * The subset of RFC 8785 we need — and what this implementation guarantees:
 *   • Object keys sorted by UTF-16 code-unit order (String#localeCompare
 *     would be wrong; Array#sort with default comparator is correct).
 *   • No insignificant whitespace.
 *   • Numbers serialized via ES2020 Number.prototype.toString, which is
 *     what JSON.stringify already produces in V8/Node.
 *   • Strings escaped per RFC 8259 with the canonical escape set
 *     (\", \\, \b, \f, \n, \r, \t, \uXXXX for control chars).
 *   • UTF-8 output (returned as a string; caller encodes via TextEncoder
 *     before hashing).
 *
 * Throws on values that JSON cannot represent (functions, Symbols, BigInts,
 * Infinity, NaN, undefined).
 *
 * Reference: https://www.rfc-editor.org/rfc/rfc8785
 */

export function jcs(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) {
    throw new Error("JCS: cannot serialize undefined");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`JCS: cannot serialize non-finite number: ${value}`);
    }
    // JSON.stringify uses ES Number#toString, which RFC 8785 mandates.
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    throw new Error("JCS: BigInt is not JSON-representable");
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error(`JCS: cannot serialize ${typeof value}`);
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalize(v));
    return "[" + parts.join(",") + "]";
  }
  if (typeof value === "object") {
    // Plain-object sorted-keys canonical form.
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // default sort = UTF-16 code-unit order
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // JSON-compatible behaviour: drop undefined props
      parts.push(JSON.stringify(k) + ":" + canonicalize(v));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`JCS: unsupported value type: ${typeof value}`);
}
