// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvelope, keyPairFromPrivate, verifyEnvelope } from '../dist/index.js';
import { acceptProtocolInput } from '../dist/acceptance.js';
import { scopeCases } from './scope-fixtures.mjs';
import { writeFileSync } from 'node:fs';
const provider = await keyPairFromPrivate(new Uint8Array(32).fill(31));
const payload = scope => ({ type: 'manifest', provider: { id: provider.did }, request_endpoint: 'https://provider.test/request', catalog_endpoint: 'https://provider.test/catalog', license_types: [{ id: 'l', terms_url: 'https://provider.test/terms', terms_hash: 'sha256:'+'0'.repeat(64), scope }] });
const sign = p => createEnvelope({ payload: p, author: provider.did, privateKey: provider.privateKey, timestamp: '2026-01-01T00:00:00Z' });
test('signed URL-only scope is not manifest acceptance despite valid crypto', async () => {
  const e = await sign(payload(['https://example.test/scope']));
  assert.equal((await verifyEnvelope(e)).ok, true);
  const r = await acceptProtocolInput({ kind: 'value', value: e }, { operation: 'manifest', purpose: 'protocol-conformance' });
  assert.equal(r.accepted, false);
  assert.deepEqual(r.errors, [{ code: 'SCOPE_INVALID', path: '/payload/license_types/0/scope' }]);
  assert.equal(r.checks.signature, 'pass');
});
const rows = [];
for (const f of scopeCases) {
  test(`signed scope raw/value ${f.name}`, async () => {
    const e = await sign(payload(f.scope));
    assert.equal((await verifyEnvelope(e)).ok, true);
    const context = { operation: 'manifest', purpose: 'protocol-conformance' };
    const outcomes = [];
    for (const source of [{ kind: 'value', value: e }, { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(e)) }]) {
      const r = await acceptProtocolInput(source, context);
      assert.equal(r.accepted, f.code === null);
      assert.deepEqual(r.errors, f.code === null ? [] : [{ code: f.code, path: '/payload/license_types/0/scope' + (f.entry === undefined ? '' : `/${f.entry}`) }]);
      assert.equal(JSON.stringify(r.snapshot.payload.license_types[0].scope), JSON.stringify(f.scope));
      assert.equal(r.checks.policy, 'not-checked');
      assert.equal(r.exclusions.policyScope, 'unresolved-excluded');
      outcomes.push({ accepted: r.accepted, errors: r.errors });
    }
    assert.deepEqual(outcomes[0], outcomes[1]); rows.push({ fixture: f.name, envelope: e, context, expected: outcomes[0] });
  });
}
test('helper rejects malformed scope without throwing or coercing', async () => {
  const { validateManifestScope } = await import('../dist/scope.js');
  for (const scope of [undefined,null,{},'commercial',[],[3],['commercial',null],['commercial',{}]]) assert.equal(validateManifestScope(scope).ok,false);
  for (const f of scopeCases) assert.equal(validateManifestScope(f.scope).ok, f.code === null, f.name);
});
test('all operational modes enforce manifest consumer evidence; inspection is non-authorizing', async () => {
  const consumer = await keyPairFromPrivate(new Uint8Array(32).fill(32));
  const termsHash = 'sha256:'+'0'.repeat(64);
  const open = await createEnvelope({ payload: { type: 'license.request', request_id: 'r', consumer: { id: consumer.did }, provider_id: provider.did, item_id: 'i', license_type: 'l', terms_hash: termsHash, status: 'OPEN' }, author: consumer.did, privateKey: consumer.privateKey, timestamp: '2026-01-01T00:00:00Z' });
  for (const f of scopeCases) {
    const manifest = await sign(payload(f.scope));
    const context = { operation: 'license-chain', purpose: 'consumer-response', sentOpen: open, manifest, expectedProvider: provider.did, item: { item_id: 'i', available_licenses: ['l'] }, licenseType: 'l', termsHash };
    for (const source of [{ kind: 'value', value: [open] },{ kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify([open])) }]) {
      const r = await acceptProtocolInput(source,context);
      assert.equal(r.accepted, f.code === null, f.name);
      assert.deepEqual(r.errors, f.code === null ? [] : [{ code: f.code, path: '/context/manifest/payload/license_types/0/scope' + (f.entry === undefined ? '' : `/${f.entry}`) }]);
    }
  }
  const e = await sign(payload(['commercial','unknown']));
  for (const operation of ['manifest','provider-open','license-chain','attestation-root','attestation-chain','inspect-envelope']) {
    const r = await acceptProtocolInput({ kind: 'value', value: operation.endsWith('-chain') ? [e] : e }, { operation, purpose: operation === 'inspect-envelope' ? 'inspection' : 'protocol-conformance', expectedProvider: provider.did });
    assert.equal(r.accepted,false,operation);
    assert.equal(r.guarantees.operationalAuthorization,false);
    assert.equal(r.checks.policy,'not-checked');
  }
});
test('scope errors locate second license deterministically', async () => {
  const p = payload(['commercial']); p.license_types.push({ ...p.license_types[0], id: 'second', scope: ['commercial','unknown'] });
  const r = await acceptProtocolInput({ kind: 'value', value: await sign(p) }, { operation:'manifest', purpose:'protocol-conformance' });
  assert.deepEqual(r.errors,[{ code:'SCOPE_INVALID', path:'/payload/license_types/1/scope/1' }]);
});
test('scope report is truthful without claiming policy.scope pass', async () => {
  const r = await acceptProtocolInput({ kind:'value', value: await sign(payload(['commercial'])) }, { operation:'manifest', purpose:'protocol-conformance' });
  assert.equal(r.exclusions.manifestScope,'pass');
  assert.equal(r.checks.policy,'not-checked');
  const bad = await acceptProtocolInput({ kind:'value', value: await sign(payload(['commercial','unknown'])) }, { operation:'manifest', purpose:'protocol-conformance' });
  assert.equal(bad.exclusions.manifestScope,'fail');
  const inspected = await acceptProtocolInput({ kind:'value', value: await sign(payload(['commercial'])) }, { operation:'inspect-envelope', purpose:'inspection' });
  assert.equal(inspected.exclusions.manifestScope,'not-checked');
  assert.equal(inspected.accepted,false);
});
test('no revocable-derived transition rule and policy.scope remains excluded', async () => {
  const key = await keyPairFromPrivate(new Uint8Array(32).fill(33));
  const termsHash = 'sha256:'+'0'.repeat(64);
  const signWith = (payload, key, in_reply_to) => createEnvelope({ payload, author:key.did, privateKey:key.privateKey, timestamp:'2026-01-01T00:00:00Z', ...(in_reply_to ? { in_reply_to } : {}) });
  const open = await signWith({ type:'license.request', request_id:'r', consumer:{id:key.did}, provider_id:provider.did, item_id:'i', license_type:'l', terms_hash:termsHash, status:'OPEN' },key);
  const chain = [open];
  for (const status of ['PENDING','GRANTED','REVOKED']) chain.push(await signWith({ type:'status.update', request_id:'r', status, ...(status === 'REVOKED' ? { reason:'cause' } : {}) },provider,chain.at(-1).payload_hash));
  const manifest = await sign(payload(['commercial']));
  const r = await acceptProtocolInput({ kind:'value', value:chain }, { operation:'license-chain', purpose:'consumer-response', sentOpen:open, manifest, expectedProvider:provider.did, item:{item_id:'i',available_licenses:['l']},licenseType:'l',termsHash });
  assert.equal(r.accepted,true,JSON.stringify(r.errors));
  for (const scope of [['unknown'],['commercial','non-commercial'],['/relative']]) {
    const e = await signWith({ type:'status.update',status:'GRANTED',subject:{id:'s'},policy:{ref:'p',scope} },key);
    const a = await acceptProtocolInput({kind:'value',value:e},{operation:'attestation-root',purpose:'protocol-conformance'});
    assert.equal(a.accepted,true);assert.equal(a.checks.policy,'not-checked');assert.equal(a.exclusions.manifestScope,'not-applicable');
  }
});
test('schema/crypto/mode errors precede scope; chain indices are envelope indices', async () => {
  const invalid = await sign(payload(['commercial','unknown']));
  for (const [value,context,expected] of [
    [{...invalid,payload_hash:'sha256:'+'1'.repeat(64)},{operation:'manifest',purpose:'protocol-conformance'},{code:'HASH_MISMATCH',path:'/payload_hash'}],
    [{...invalid,signature:'ed25519:'+'0'.repeat(128)},{operation:'manifest',purpose:'protocol-conformance'},{code:'SIGNATURE_INVALID',path:'/signature'}],
    [[invalid],{operation:'license-chain',purpose:'protocol-conformance'},{code:'ROOT_INVALID',path:'/0/payload/type',index:0}],
  ]) {
    const r = await acceptProtocolInput({kind:'value',value},context);assert.deepEqual(r.errors,[expected]);assert.equal(r.exclusions.manifestScope,'not-checked');
  }
  const malformed = await sign(payload([]));
  const r = await acceptProtocolInput({kind:'value',value:[malformed]},{operation:'attestation-chain',purpose:'protocol-conformance'});
  assert.deepEqual(r.errors,[{code:'SCHEMA_INVALID',path:'/0/payload/license_types/0/scope',index:0}]);
});
test('own signed fixture record', () => {
  if (process.env.H3_RECORD) writeFileSync(process.env.H3_RECORD,JSON.stringify({ cases: rows.length, rows },null,2)+'\n');
});
