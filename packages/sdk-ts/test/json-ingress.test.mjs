// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ingress from '../dist/json-ingress.js';
import { jcs } from '../dist/jcs.js';
const { parseProtocolJson, snapshotJsonValue, JsonIngressError } = ingress;
const enc = new TextEncoder();
const cases = JSON.parse(readFileSync(new URL('./fixtures/strict-json/cases.json', import.meta.url)));
for (const c of cases) test(c.name, () => {
  assert.throws(() => parseProtocolJson(enc.encode(c.raw)), e => {
    assert.ok(e instanceof JsonIngressError);
    assert.equal(e.code, c.code);
    if ('position' in c) assert.equal(e.position, c.position);
    assert.ok(!e.message.includes('SECRET'));
    return true;
  });
});
for (const [name, bytes, code] of [
  ['BOM', [239,187,191,123,125], 'BOM_UNSUPPORTED'],
  ['BOM before bad UTF8', [239,187,191,255], 'BOM_UNSUPPORTED'],
  ['replacement', [34,255,34], 'UTF8_INVALID'],
  ['overlong', [34,192,175,34], 'UTF8_INVALID'],
  ['truncated', [34,226,130], 'UTF8_INVALID'],
  ['surrogate bytes', [34,237,160,128,34], 'UTF8_INVALID'],
  ['out of range', [34,244,144,128,128,34], 'UTF8_INVALID'],
]) test(name, () => assert.throws(() => parseProtocolJson(Uint8Array.from(bytes)), e => e.code === code));

test('positive controls: scopes, names, Unicode, binary64', () => {
  const raw = '{"a":{"x":1},"b":{"x":2},"__proto__":{"safe":true},"constructor":3,"s":"é é 😀 ﻿","n":9007199254740993,"z":-0}';
  const actual = parseProtocolJson(enc.encode(raw));
  assert.equal(jcs(actual), jcs(JSON.parse(raw)));
  assert.ok(Object.hasOwn(actual, '__proto__'));
  assert.equal({}.safe, undefined);
  assert.equal(actual.n, 9007199254740992);
  assert.ok(Object.is(actual.z, -0));
});

test('snapshot rejects unsupported domain without getter/toJSON execution', () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, 'a', { enumerable:true, get() { calls++; return 1; } });
  const arrayAccessor = Object.defineProperty([1], '0', { enumerable:true, get() { calls++; return 1; } });
  const extra = [1]; extra.x = 2;
  const hidden = Object.defineProperty({}, 'h', { value: 1 });
  const symbol = { [Symbol('s')]: 1 };
  const cycle = {}; cycle.self = cycle;
  for (const v of [undefined, () => 1, Symbol(), 1n, NaN, Infinity, -Infinity, new Date(), new Number(1), Object.create({}), accessor, arrayAccessor, extra, hidden, symbol, cycle, [,,], {x:undefined}, {toJSON(){ calls++; return 1; }}]) {
    assert.throws(() => snapshotJsonValue(v), e => e.code === 'JSON_DOMAIN');
    assert.throws(() => jcs(v), e => e.code === 'JSON_DOMAIN');
  }
  assert.equal(calls, 0);
});

test('snapshot copies shared acyclic refs, null prototype, proto data and order', () => {
  const shared = Object.assign(Object.create(null), { a: 1 });
  const original = { a: shared, b: shared, list:[3,1,2] };
  const copy = snapshotJsonValue(original);
  assert.notEqual(copy.a, shared); assert.notEqual(copy.a, copy.b);
  shared.a = 2; assert.equal(copy.a.a, 1);
  assert.equal(jcs(copy), '{"a":{"a":1},"b":{"a":1},"list":[3,1,2]}');
  assert.equal(jcs(JSON.parse('{"__proto__":1}')), '{"__proto__":1}');
});

// F1: native parsing accepts these inputs; helpers must not depend on the
// native call stack. Inspect snapshots iteratively too (no deepEqual/stringify).
for (const depth of [6000, 10000]) for (const shape of ['array', 'object']) {
  const raw = (shape === 'array' ? '[' : '{"a":').repeat(depth) + '0' + (shape === 'array' ? ']' : '}').repeat(depth);
  for (const operation of ['raw', 'value', 'JCS']) test(`F1 ${shape} ${depth} ${operation}`, () => {
    const native = JSON.parse(raw);
    if (operation === 'JCS') { assert.equal(jcs(native), raw); return; }
    const result = operation === 'raw' ? parseProtocolJson(enc.encode(raw)) : snapshotJsonValue(native);
    let input = native, output = result;
    for (let i = 0; i < depth; i++) {
      assert.notEqual(output, input);
      assert.equal(Array.isArray(output), shape === 'array');
      assert.deepEqual(Object.keys(output), [shape === 'array' ? '0' : 'a']);
      if (shape === 'object') assert.equal(Object.getPrototypeOf(output), null);
      input = input[shape === 'array' ? 0 : 'a']; output = output[shape === 'array' ? 0 : 'a'];
    }
    assert.equal(output, 0);
  });
}

test('F1 deep mixed frames resume siblings and keep duplicate scopes separate', () => {
  const depth = 6000;
  let raw = '{"a":0,"b":1}';
  for (let i = 0; i < depth; i++) raw = i % 2 ? '{"a":'+raw+',"b":2}' : '['+raw+',3]';
  const value = parseProtocolJson(enc.encode(raw));
  assert.equal(jcs(value), raw);
  // Duplicate and syntax offsets still refer to the original UTF-16 input,
  // even after a complete deep child has returned to its parent frame.
  const duplicate = '{"a":'+raw+',"\\u0061":1}';
  assert.throws(() => parseProtocolJson(enc.encode(duplicate)), e =>
    e instanceof JsonIngressError && e.code === 'JSON_DUPLICATE_KEY' && e.position === raw.length + 6);
  const badSeparator = '['+raw+'!0]';
  assert.throws(() => parseProtocolJson(enc.encode(badSeparator)), e =>
    e instanceof JsonIngressError && e.code === 'JSON_SYNTAX' && e.position === raw.length + 2);
});

test('F1 deep ancestor lifetime: cycles reject, shared acyclic branches copy independently', () => {
  const root = {}, shared = { x: 1 };
  let tail = root;
  for (let i = 0; i < 10000; i++) tail = tail.a = {};
  tail.b = shared; tail.c = shared;
  const result = snapshotJsonValue(root);
  let copy = result;
  for (let i = 0; i < 10000; i++) copy = copy.a;
  assert.notEqual(copy.b, copy.c); assert.notEqual(copy.b, shared);
  assert.equal(jcs(result), '{"a":'.repeat(10000)+'{"b":{"x":1},"c":{"x":1}}'+'}'.repeat(10000));
  tail.c = root;
  for (const fn of [snapshotJsonValue, jcs]) assert.throws(() => fn(root), e => e.code === 'JSON_DOMAIN');
});

// xorshift32 seeds; 500 cases each, max nesting 4. Differential oracle is
// native JSON.parse plus independent sorted-key serialization, not JCS itself.
for (const seed of [0x12345678, 0xdeadbeef, 0x5eed8785]) test(`differential seed ${seed.toString(16)}: 500 cases`, () => {
  let state = seed;
  const rnd = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const strings = ['', 'a"b', 'a\\b', '__proto__', 'constructor', 'é', 'é', '😀', '\r', '\u0080', '\ufeff', '\ufffd', '\ufb33'];
  const nums = [0, -0, 5e-324, 1.7976931348623157e308, 9007199254740992, 1e21, 1e-7, 333333333.33333329];
  function gen(depth = 0) {
    const kind = rnd() % (depth === 4 ? 5 : 7);
    if (kind === 0) return null;
    if (kind === 1) return !!(rnd() % 2);
    if (kind === 2) return nums[rnd() % nums.length];
    if (kind === 3) return strings[rnd() % strings.length];
    if (kind === 4) return (rnd() - 0x80000000) / (rnd() + 1);
    if (kind === 5) return Array.from({length:rnd()%5}, () => gen(depth+1));
    const obj = Object.create(null);
    for (let n = rnd()%5; n > 0; n--) obj[strings[rnd()%strings.length]] = gen(depth+1);
    return obj;
  }
  const canonical = v => v && typeof v === 'object'
    ? Array.isArray(v) ? '['+v.map(canonical).join(',')+']'
      : '{'+Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'
    : JSON.stringify(v);
  for (let n = 0; n < 500; n++) {
    const raw = JSON.stringify(gen());
    const escaped = raw.replace(/[é😀]/gu, c => Array.from({length:c.length}, (_,i) => '\\u'+c.charCodeAt(i).toString(16).padStart(4,'0')).join(''));
    const expected = canonical(JSON.parse(raw));
    assert.equal(jcs(parseProtocolJson(enc.encode(escaped))), expected, `case ${n}`);
    const name = strings[rnd()%strings.length];
    const quoted = JSON.stringify(name);
    const escapedName = '"'+Array.from({length:name.length}, (_,i) => '\\u'+name.charCodeAt(i).toString(16).padStart(4,'0')).join('')+'"';
    const duplicate = '{'+quoted+':0,'+escapedName+':1}';
    assert.throws(() => parseProtocolJson(enc.encode('[{"nested":'+duplicate+'}]')), e => e.code === 'JSON_DUPLICATE_KEY', `duplicate ${n}`);
  }
});

test('RFC 8785 numeric and UTF16 sorting controls', () => {
  assert.equal(jcs([333333333.33333329, 1e30, 4.50, 2e-3, 1e-27]), '[333333333.3333333,1e+30,4.5,0.002,1e-27]');
  const keys = ['\u20ac', '\r', '\ufb33', '1', '\ud83d\ude00', '\u0080', '\u00f6'];
  assert.equal(jcs(Object.fromEntries(keys.map(k=>[k,1]))), '{"\\r":1,"1":1,"\u0080":1,"ö":1,"€":1,"😀":1,"דּ":1}');
});
