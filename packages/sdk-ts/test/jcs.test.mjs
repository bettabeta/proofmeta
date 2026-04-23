// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * JCS (RFC 8785) conformance tests.
 *
 * JCS is trust-chain critical — every envelope's payload_hash depends on it.
 * If two implementations canonicalize the same payload differently, signatures
 * do not verify across stacks and the ecosystem splits silently.
 *
 * These vectors cover the subset of RFC 8785 we actually rely on:
 *   • Key ordering (UTF-16 code-unit)
 *   • Number serialization (integers, zero, negatives, exponents, edge magnitudes)
 *   • String escapes (control chars, quote, backslash, unicode)
 *   • Surrogate pairs (astral-plane characters)
 *   • Nested structures and arrays (arrays preserve order; objects sort keys)
 *   • Empty object and empty array
 *   • `undefined` property dropping (JSON-compatible behaviour)
 *   • Error cases: NaN / Infinity / BigInt / function / symbol / top-level undefined
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { jcs, hashPayload } from "../dist/index.js";

// ── Primitives ────────────────────────────────────────────────────────────

test("null, booleans, integers", () => {
  assert.equal(jcs(null), "null");
  assert.equal(jcs(true), "true");
  assert.equal(jcs(false), "false");
  assert.equal(jcs(0), "0");
  assert.equal(jcs(-0), "0"); // ES toString(-0) === "0"
  assert.equal(jcs(1), "1");
  assert.equal(jcs(-17), "-17");
});

test("numbers: exponents and magnitudes match ES Number#toString", () => {
  // RFC 8785 mandates ES2020 Number serialization; this is exactly what
  // JSON.stringify produces. These vectors lock the contract.
  assert.equal(jcs(1e21), "1e+21");
  assert.equal(jcs(1e-7), "1e-7");
  assert.equal(jcs(1e-6), "0.000001");
  assert.equal(jcs(100), "100");
  assert.equal(jcs(1.5), "1.5");
  assert.equal(jcs(0.1), "0.1");
});

test("strings: basic and canonical escapes", () => {
  assert.equal(jcs(""), '""');
  assert.equal(jcs("hello"), '"hello"');
  assert.equal(jcs('quote:"'), '"quote:\\""');
  assert.equal(jcs("back\\slash"), '"back\\\\slash"');
  assert.equal(jcs("\b\f\n\r\t"), '"\\b\\f\\n\\r\\t"');
  // Control char < 0x20 not in the canonical-escape set gets \uXXXX
  assert.equal(jcs("\u0001"), '"\\u0001"');
});

test("strings: surrogate pair (astral-plane character)", () => {
  // U+1F600 GRINNING FACE — encoded as UTF-16 surrogate pair.
  // RFC 8785 keeps the character literal in output; JSON.stringify already
  // does this. This test guards against any future regression where we
  // accidentally \u-escape non-control characters.
  assert.equal(jcs("\u{1F600}"), '"\u{1F600}"');
});

// ── Object key ordering ───────────────────────────────────────────────────

test("object keys sorted by UTF-16 code-unit order", () => {
  // Default Array#sort is UTF-16 code-unit order, which is what RFC 8785
  // specifies. localeCompare would be wrong.
  assert.equal(
    jcs({ b: 1, a: 2, c: 3 }),
    '{"a":2,"b":1,"c":3}',
  );
});

test("object keys: case and digit ordering", () => {
  // '0'..'9' (0x30..0x39) < 'A'..'Z' (0x41..0x5A) < 'a'..'z' (0x61..0x7A)
  assert.equal(
    jcs({ a: 1, Z: 2, "0": 3, B: 4 }),
    '{"0":3,"B":4,"Z":2,"a":1}',
  );
});

test("object keys: mixed-length shared prefix", () => {
  // Shorter string sorts before longer string with shared prefix.
  assert.equal(
    jcs({ ab: 1, a: 2, abc: 3 }),
    '{"a":2,"ab":1,"abc":3}',
  );
});

test("nested object keys are sorted at every level", () => {
  assert.equal(
    jcs({ z: { b: 1, a: 2 }, a: { y: 1, x: 2 } }),
    '{"a":{"x":2,"y":1},"z":{"a":2,"b":1}}',
  );
});

// ── Arrays ────────────────────────────────────────────────────────────────

test("arrays preserve input order (no sorting)", () => {
  assert.equal(jcs([3, 1, 2]), "[3,1,2]");
  assert.equal(jcs(["b", "a", "c"]), '["b","a","c"]');
});

test("arrays of objects: element order preserved, keys sorted", () => {
  assert.equal(
    jcs([{ b: 1, a: 2 }, { d: 3, c: 4 }]),
    '[{"a":2,"b":1},{"c":4,"d":3}]',
  );
});

// ── Empty collections ─────────────────────────────────────────────────────

test("empty object and empty array", () => {
  assert.equal(jcs({}), "{}");
  assert.equal(jcs([]), "[]");
  assert.equal(jcs({ a: [] }), '{"a":[]}');
  assert.equal(jcs({ a: {} }), '{"a":{}}');
});

// ── Undefined handling ────────────────────────────────────────────────────

test("undefined property values are dropped (JSON-compatible)", () => {
  assert.equal(jcs({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
});

test("top-level undefined throws", () => {
  assert.throws(() => jcs(undefined), /undefined/);
});

test("array elements of undefined are not allowed — JSON produces null, we reject", () => {
  // RFC 8259 has no bare `undefined`; JSON.stringify emits null for array
  // holes. Our implementation throws instead, refusing the ambiguity.
  assert.throws(() => jcs([1, undefined, 3]), /undefined/);
});

// ── Unrepresentable numbers ───────────────────────────────────────────────

test("NaN, Infinity, -Infinity throw", () => {
  assert.throws(() => jcs(Number.NaN), /non-finite/);
  assert.throws(() => jcs(Number.POSITIVE_INFINITY), /non-finite/);
  assert.throws(() => jcs(Number.NEGATIVE_INFINITY), /non-finite/);
});

test("BigInt throws (no JSON representation)", () => {
  assert.throws(() => jcs(1n), /BigInt/);
});

// ── Unrepresentable types ─────────────────────────────────────────────────

test("functions and symbols throw", () => {
  assert.throws(() => jcs(() => 1), /function/);
  assert.throws(() => jcs(Symbol("s")), /symbol/);
});

// ── hashPayload determinism ───────────────────────────────────────────────

test("hashPayload: key order does not change the hash", () => {
  const a = hashPayload({ a: 1, b: 2, c: 3 });
  const b = hashPayload({ c: 3, a: 1, b: 2 });
  const c = hashPayload({ b: 2, c: 3, a: 1 });
  assert.equal(a, b);
  assert.equal(b, c);
});

test("hashPayload: nested key order does not change the hash", () => {
  const a = hashPayload({ outer: { a: 1, b: 2 }, list: [{ y: 1, x: 2 }] });
  const b = hashPayload({ list: [{ x: 2, y: 1 }], outer: { b: 2, a: 1 } });
  assert.equal(a, b);
});

test("hashPayload: array order DOES change the hash", () => {
  // Guardrail: arrays are ordered; swapping elements must produce a
  // different hash.
  const a = hashPayload({ tags: ["a", "b"] });
  const b = hashPayload({ tags: ["b", "a"] });
  assert.notEqual(a, b);
});

test("hashPayload: format is sha256:<64 hex chars>", () => {
  const h = hashPayload({ x: 1 });
  assert.match(h, /^sha256:[a-f0-9]{64}$/);
});
