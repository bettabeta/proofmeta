// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonIngressCode = 'UTF8_INVALID' | 'BOM_UNSUPPORTED' | 'JSON_SYNTAX' | 'JSON_DUPLICATE_KEY' | 'JSON_DOMAIN';

/** Position is a UTF-16 offset for tokenizer errors, byte offset for BOM.
 * Domain and decoder errors have no position; messages never contain input. */
export class JsonIngressError extends Error {
  constructor(public readonly code: JsonIngressCode, reason: string, public readonly position?: number) {
    super(`${code}: ${reason}${position === undefined ? '' : ` at ${position}`}`);
    this.name = 'JsonIngressError';
  }
}

function domain(reason: string): never { throw new JsonIngressError('JSON_DOMAIN', reason); }
function unicode(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) domain('lone surrogate');
    } else if (c >= 0xdc00 && c <= 0xdfff) domain('lone surrogate');
  }
}

/** Detached JSON-domain snapshot. Does not read getters or call toJSON.
 * Arbitrary hostile proxies / same-process code are not a security boundary. */
export function snapshotJsonValue(value: unknown): JsonValue {
  type Frame = {
    obj: object; array: boolean; descriptors: PropertyDescriptorMap;
    keys: (string | symbol)[]; index: number; length: number;
    result: JsonValue[] | { [key: string]: JsonValue };
  };
  const active = new Set<object>();
  const frames: Frame[] = [];
  // Enter only one node; descent and ancestor cleanup belong to the loop.
  function enter(v: unknown): JsonValue {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { unicode(v); return v; }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) domain('non-finite number');
      return v;
    }
    if (typeof v !== 'object') domain(`unsupported ${typeof v === 'bigint' ? 'BigInt' : typeof v}`);
    const obj = v as object;
    if (active.has(obj)) domain('cycle');
    const array = Array.isArray(obj);
    const proto = Object.getPrototypeOf(obj);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) domain('unsupported prototype');
    active.add(obj);
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    const keys = Reflect.ownKeys(descriptors);
    const result: JsonValue[] | { [key: string]: JsonValue } = array ? [] : Object.create(null);
    const length = array ? descriptors.length.value as number : 0;
    if (array && keys.length !== length + 1) domain('sparse or extra array properties');
    frames.push({ obj, array, descriptors, keys, index: 0, length, result });
    return result;
  }
  const result = enter(value);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.index === frame.keys.length) {
      active.delete(frame.obj); frames.pop(); continue;
    }
    const key = frame.keys[frame.index++];
    if (typeof key !== 'string') domain('symbol property');
    if (frame.array && key === 'length') continue;
    const d = frame.descriptors[key];
    if (!d.enumerable || !('value' in d)) domain('nonenumerable or accessor property');
    unicode(key);
    if (frame.array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= frame.length)) domain('extra array property');
    Object.defineProperty(frame.result, key, { value: enter(d.value), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

/** Token scan with one decoded-name set per object frame. JSON.parse remains
 * the final grammar/value parser. First scanner fault wins, then domain check. */
function scan(text: string): void {
  let i = 0;
  const syntax = (): never => { throw new JsonIngressError('JSON_SYNTAX', 'invalid JSON', i); };
  const ws = () => { while (i < text.length && /[\x20\x09\x0a\x0d]/.test(text[i])) i++; };
  function string(): string {
    const start = i;
    if (text[i++] !== '"') syntax();
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        try { return JSON.parse(text.slice(start, i)) as string; } catch { syntax(); }
      }
      if (c.charCodeAt(0) < 0x20) syntax();
      if (c === '\\') {
        const escape = text[i++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) syntax();
          i += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) syntax();
      }
    }
    return syntax();
  }
  type Frame = { kind: 'value' } | { kind: 'array' } |
    { kind: 'object'; names: Set<string>; phase: 'key' | 'after' };
  const frames: Frame[] = [{ kind: 'value' }];
  while (frames.length) {
    const frame = frames.pop()!;
    if (frame.kind === 'object' && frame.phase === 'key') {
      ws(); const position = i;
      const name = string();
      if (frame.names.has(name)) throw new JsonIngressError('JSON_DUPLICATE_KEY', 'duplicate property', position);
      frame.names.add(name); ws();
      if (text[i++] !== ':') syntax();
      frame.phase = 'after'; frames.push(frame, { kind: 'value' });
      continue;
    }
    if (frame.kind !== 'value') {
      ws();
      const close = frame.kind === 'array' ? ']' : '}';
      if (text[i] === close) { i++; continue; }
      if (text[i++] !== ',') syntax();
      if (frame.kind === 'object') { frame.phase = 'key'; frames.push(frame); }
      else frames.push(frame, { kind: 'value' });
      continue;
    }
    ws();
    const c = text[i];
    if (c === '"') { string(); continue; }
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') { i++; continue; }
      frames.push({ kind: 'object', names: new Set<string>(), phase: 'key' });
      continue;
    }
    if (c === '[') {
      i++; ws();
      if (text[i] === ']') { i++; continue; }
      frames.push({ kind: 'array' }, { kind: 'value' });
      continue;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) syntax();
    i += token![0].length;
  }
  ws();
  if (i !== text.length) syntax();
}

export function parseProtocolJson(bytes: Uint8Array): JsonValue {
  if (!(bytes instanceof Uint8Array)) domain('expected Uint8Array');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JsonIngressError('BOM_UNSUPPORTED', 'transport BOM', 0);
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new JsonIngressError('UTF8_INVALID', 'invalid UTF-8'); }
  scan(text);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new JsonIngressError('JSON_SYNTAX', 'invalid JSON'); }
  return snapshotJsonValue(value);
}
