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

import { snapshotJsonValue, type JsonValue } from './json-ingress.js';

export function jcs(value: unknown): string {
  return canonicalize(snapshotJsonValue(value));
}

function canonicalize(value: JsonValue): string {
  type Frame = { kind: 'value'; value: JsonValue } |
    { kind: 'array'; value: JsonValue[]; index: number } |
    { kind: 'object'; value: { [key: string]: JsonValue }; keys: string[]; index: number };
  const frames: Frame[] = [{ kind: 'value', value }];
  const parts: string[] = [];
  // Emit tokens in traversal order, joining once rather than repeatedly
  // rebuilding ancestor strings. JSON.stringify sees only validated scalars.
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.kind === 'value') {
      frames.pop();
      const v = frame.value;
      if (v === null || typeof v !== 'object') { parts.push(JSON.stringify(v)); continue; }
      if (Array.isArray(v)) {
        parts.push('['); frames.push({ kind: 'array', value: v, index: 0 });
      } else {
        parts.push('{'); frames.push({ kind: 'object', value: v, keys: Object.keys(v).sort(), index: 0 });
      }
      continue;
    }
    const length = frame.kind === 'array' ? frame.value.length : frame.keys.length;
    if (frame.index === length) {
      parts.push(frame.kind === 'array' ? ']' : '}'); frames.pop(); continue;
    }
    if (frame.index) parts.push(',');
    const index = frame.index++;
    if (frame.kind === 'array') frames.push({ kind: 'value', value: frame.value[index] });
    else {
      const key = frame.keys[index];
      parts.push(JSON.stringify(key), ':');
      frames.push({ kind: 'value', value: frame.value[key] });
    }
  }
  return parts.join('');
}
