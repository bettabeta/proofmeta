// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { keyPairFromPrivate, createEnvelope } from '../dist/index.js';
const api = await import('../dist/acceptance.js').catch(() => ({}));
const provider = await keyPairFromPrivate(new Uint8Array(32).fill(1));
const consumer = await keyPairFromPrivate(new Uint8Array(32).fill(2));
const terms = 'sha256:' + '0'.repeat(64);
const request = { type: 'license.request', request_id: 'req-1', consumer: { id: consumer.did }, provider_id: provider.did, item_id: 'item-1', license_type: 'free', terms_hash: terms, status: 'OPEN' };
async function sign(payload = request, timestamp = '2026-01-01T00:00:00Z', key = consumer, extra = {}) {
  return createEnvelope({ payload: structuredClone(payload), timestamp, author: key.did, privateKey: key.privateKey, ...extra });
}
async function accept(value, context = { operation: 'provider-open', purpose: 'protocol-conformance', expectedProvider: provider.did }) {
  assert.equal(typeof api.acceptProtocolInput, 'function', 'shared Acceptance API must exist');
  return api.acceptProtocolInput({ kind: 'value', value }, context);
}
test('signed invalid date is schema reject, not crypto acceptance', async () => {
  const r = await accept(await sign(request, 'not-a-date'));
  assert.equal(r.accepted, false); assert.equal(r.errors[0].code, 'SCHEMA_INVALID'); assert.equal(r.checks.signature, 'not-checked');
});
test('UTC -00:00 and nonzero offsets reject before signature', async () => {
  for (const stamp of ['2026-01-01T00:00:00-00:00', '2026-01-01T00:00:00+01:00']) {
    const r = await accept(await sign(request, stamp));
    assert.equal(r.accepted, false); assert.equal(r.errors[0].code, 'SCHEMA_INVALID'); assert.equal(r.checks.signature, 'not-checked');
  }
});
test('OPEN with signed parent rejects root context', async () => {
  const r = await accept(await sign(request, undefined, consumer, { in_reply_to: terms }));
  assert.equal(r.accepted, false); assert.equal(r.errors[0].code, 'ROOT_INVALID');
});
test('provider binding missing is fail, not skip', async () => {
  const r = await accept(await sign(), { operation: 'provider-open', purpose: 'protocol-conformance' });
  assert.equal(r.accepted, false); assert.equal(r.errors[0].code, 'CONTEXT_REQUIRED');
});
test('wrong expected provider is context reject', async () => {
  const r = await accept(await sign(), { operation: 'provider-open', purpose: 'protocol-conformance', expectedProvider: consumer.did });
  assert.equal(r.accepted, false); assert.equal(r.errors[0].code, 'CONTEXT_MISMATCH');
});
test('hash error is not misreported as signature failure', async () => {
  const e = await sign(); e.payload.item_id = 'mutated';
  const r = await accept(e); assert.equal(r.errors[0].code, 'HASH_MISMATCH'); assert.equal(r.checks.signature, 'not-checked');
});
test('signed wrong OPEN consumer is authority reject', async () => {
  const r = await accept(await sign(request, undefined, provider));
  assert.equal(r.errors[0].code, 'AUTHORITY_MISMATCH'); assert.equal(r.checks.signature, 'pass');
});
test('inspection supports unknown payload but never accepted', async () => {
  const r = await accept(await sign({ type: 'extension', data: 1 }), { operation: 'inspect-envelope', purpose: 'inspection' });
  assert.equal(r.accepted, false); assert.equal(r.errors.length, 0); assert.equal(r.checks.hash, 'pass'); assert.equal(r.checks.context, 'not-applicable');
});
test('operational unknown payload fails unsupported', async () => {
  const r = await accept(await sign({ type: 'extension' })); assert.equal(r.errors[0].code, 'PAYLOAD_UNSUPPORTED');
});
const chainContext = { operation: 'license-chain', purpose: 'protocol-conformance' };
async function licenseChain() {
  const open = await sign();
  const pending = await sign({ type: 'status.update', request_id: 'req-1', status: 'PENDING' }, undefined, provider, { in_reply_to: open.payload_hash });
  const granted = await sign({ type: 'status.update', request_id: 'req-1', status: 'GRANTED', valid_until: '2099-01-01T00:00:00+03:00' }, undefined, provider, { in_reply_to: pending.payload_hash });
  return [open, pending, granted];
}
async function manifestEnvelope() {
  return sign({ type: 'manifest', provider: { id: provider.did }, request_endpoint: 'https://provider.test/request', items: [{ item_id: 'item-1', name: 'Item', available_licenses: ['free'] }], license_types: [{ id: 'free', terms_url: 'https://provider.test/terms', terms_hash: terms, scope: ['commercial'] }] }, undefined, provider);
}
async function consumerContext(chain) {
  return { operation: 'license-chain', purpose: 'consumer-response', sentOpen: chain[0], expectedProvider: provider.did, manifest: await manifestEnvelope(), item: { item_id: 'item-1', name: 'Item', available_licenses: ['free'] }, licenseType: 'free', termsHash: terms };
}
test('valid license chain and valid_until non-UTC positive control', async () => {
  const r = await accept(await licenseChain(), chainContext); assert.equal(r.accepted, true);
});
test('Mode A GRANTED root cannot be a license chain', async () => {
  const r = await accept([await sign({ type: 'status.update', request_id: 'req-1', status: 'GRANTED' })], chainContext);
  assert.equal(r.errors[0].code, 'ROOT_INVALID');
});
test('wrong parent, request, transition, resolver have ordered stable codes', async () => {
  for (const [mutation, code] of [
    [async c => { c[1] = await sign(c[1].payload, undefined, provider, { in_reply_to: terms }); }, 'PARENT_MISMATCH'],
    [async c => { c[1] = await sign({ ...c[1].payload, request_id: 'foreign' }, undefined, provider, { in_reply_to: c[0].payload_hash }); }, 'CONTEXT_MISMATCH'],
    [async c => { c[1] = await sign({ ...c[1].payload, status: 'GRANTED' }, undefined, provider, { in_reply_to: c[0].payload_hash }); }, 'TRANSITION_INVALID'],
    [async c => { c[1] = await sign(c[1].payload, undefined, consumer, { in_reply_to: c[0].payload_hash }); }, 'AUTHORITY_MISMATCH'],
  ]) {
    const c = await licenseChain(); await mutation(c);
    const r = await accept(c, chainContext); assert.equal(r.accepted, false); assert.equal(r.errors[0].code, code); assert.equal(r.errors[0].index, 1);
  }
});
test('consumer response binds signed sent OPEN, provider, manifest, item, license and terms', async () => {
  const c = await licenseChain(); const ctx = await consumerContext(c);
  const positive = await accept(c, ctx); assert.equal(positive.accepted, true, JSON.stringify(positive.errors));
  for (const key of ['sentOpen', 'expectedProvider', 'manifest', 'item', 'licenseType', 'termsHash']) {
    const missing = { ...ctx }; delete missing[key];
    assert.equal((await accept(c, missing)).errors[0].code, 'CONTEXT_REQUIRED', key);
  }
  for (const patch of [{ expectedProvider: consumer.did }, { licenseType: 'other' }, { termsHash: 'sha256:'+'1'.repeat(64) }, { item: { item_id: 'foreign', name: 'Other', available_licenses: ['free'] } }]) {
    assert.equal((await accept(c, { ...ctx, ...patch })).errors[0].code, 'CONTEXT_MISMATCH');
  }
});
test('replayed valid foreign OPEN rejects even same request_id and payload_hash', async () => {
  const c = await licenseChain(); const ctx = await consumerContext(c);
  ctx.sentOpen = await sign(request, '2026-01-02T00:00:00Z');
  assert.equal((await accept(c, ctx)).errors[0].code, 'CONTEXT_MISMATCH');
});
test('unsigned sent OPEN rejects, not just projection equality', async () => {
  const c = await licenseChain(); const ctx = await consumerContext(c);
  ctx.sentOpen = { ...c[0], signature: 'ed25519:'+'0'.repeat(128) };
  assert.equal((await accept(c, ctx)).errors[0].code, 'SIGNATURE_INVALID');
});
test('Mode B root and free constant author/subject history positive controls', async () => {
  const root = await sign({ type: 'status.update', status: 'REVOKED', reason: 'For cause', subject: { id: 'subject' }, policy: { ref: 'policy' } });
  assert.equal((await accept(root, { operation: 'attestation-root', purpose: 'protocol-conformance' })).accepted, true);
  const next = await sign({ type: 'status.update', status: 'GRANTED', subject: { id: 'subject' }, policy: { ref: 'different-policy' } }, undefined, consumer, { in_reply_to: root.payload_hash });
  assert.equal((await accept([root,next], { operation: 'attestation-chain', purpose: 'protocol-conformance' })).accepted, true);
  const wrong = await sign({ ...next.payload, subject: { id: 'other' } }, undefined, consumer, { in_reply_to: root.payload_hash });
  assert.equal((await accept([root,wrong], { operation: 'attestation-chain', purpose: 'protocol-conformance' })).errors[0].code, 'CONTEXT_MISMATCH');
});
test('missing context and operation/purpose mismatch structured reject', async () => {
  const e = await sign();
  for (const ctx of [undefined, {}, { operation: 'unknown', purpose: 'inspection' }, { operation: 'license-chain', purpose: 'inspection' }]) {
    assert.equal((await api.acceptProtocolInput({ kind: 'value', value: e }, ctx)).errors[0].code, 'CONTEXT_REQUIRED');
  }
});
test('raw byte markers and duplicate input fail', async () => {
  const e = await sign(); const bytes = new TextEncoder().encode(JSON.stringify(e));
  const r = await api.acceptProtocolInput({ kind: 'bytes', bytes }, { operation: 'provider-open', purpose: 'protocol-conformance', expectedProvider: provider.did });
  assert.equal(r.accepted, true); assert.equal(r.ingress.rawEncoding, 'pass'); assert.equal(r.ingress.duplicateKeys, 'pass');
  const bad = new TextEncoder().encode('{"a":1,"a":2}');
  assert.equal((await api.acceptProtocolInput({ kind: 'bytes', bytes: bad }, chainContext)).errors[0].code, 'JSON_DUPLICATE_KEY');
});
test('schema rejects null/primitive/array and signature syntax deterministically', async () => {
  for (const v of [null, 1, [], 'x']) assert.equal((await accept(v)).errors[0].code, 'SCHEMA_INVALID');
  const e = await sign();
  for (const signature of [e.signature.toUpperCase(), 'ed25519:00']) assert.equal((await accept({ ...e, signature })).errors[0].code, 'SCHEMA_INVALID');
});
test('policy.scope is never silently pass', async () => {
  const e = await sign({ type: 'status.update', status: 'GRANTED', subject: { id: 'subject' }, policy: { ref: 'p', scope: ['unknown'] } });
  const r = await accept(e, { operation: 'attestation-root', purpose: 'protocol-conformance' });
  assert.equal(r.accepted, true); assert.equal(r.checks.policy, 'not-checked'); assert.equal(r.exclusions.policyScope, 'unresolved-excluded');
});
test('malformed source wrapper and byte coercion are domain reject', async () => {
  for (const source of [null, {}, { kind: 'unexpected', value: await sign() }, { kind: 'bytes', bytes: [] }]) {
    const r = await api.acceptProtocolInput(source, chainContext); assert.equal(r.errors[0].code, 'JSON_DOMAIN');
  }
});
test('raw markers expose the stage actually checked on duplicate failure', async () => {
  const r = await api.acceptProtocolInput({ kind: 'bytes', bytes: new TextEncoder().encode('{"a":1,"a":2}') }, chainContext);
  assert.equal(r.ingress.rawEncoding, 'pass'); assert.equal(r.ingress.duplicateKeys, 'fail');
});
test('UTC Z/z/+00:00/fractions preserve signed bytes', async () => {
  for (const stamp of ['2026-01-01T00:00:00Z','2026-01-01t00:00:00z','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00.123456Z']) {
    const r = await accept(await sign(request, stamp)); assert.equal(r.accepted, true); assert.equal(r.snapshot.timestamp, stamp);
  }
});
test('mixed/neither modes, missing/empty request and empty policy ref schema reject', async () => {
  for (const payload of [
    { type: 'status.update', status: 'GRANTED' },
    { type: 'status.update', status: 'GRANTED', request_id: 'r', subject: { id: 's' }, policy: { ref: 'p' } },
    { type: 'status.update', status: 'GRANTED', request_id: '' },
    { type: 'status.update', status: 'GRANTED', subject: { id: 's' }, policy: { ref: '' } },
    Object.fromEntries(Object.entries(request).filter(([k]) => k !== 'request_id')),
    { ...request, request_id: '' }
  ]) assert.equal((await accept(await sign(payload))).errors[0].code, 'SCHEMA_INVALID');
});
test('source and context cannot change while DID resolution awaits', async () => {
  const did = 'did:web:consumer.test';
  const e = await createEnvelope({ payload: { ...request, consumer: { id: did } }, author: did, timestamp: '2026-01-01T00:00:00Z', privateKey: consumer.privateKey });
  let resume; const wait = new Promise(r => resume = r);
  const ctx = { operation: 'provider-open', purpose: 'protocol-conformance', expectedProvider: provider.did, resolveAuthor: async a => { assert.equal(a, did); await wait; return consumer.publicKey; } };
  const pending = api.acceptProtocolInput({ kind: 'value', value: e }, ctx);
  e.payload.item_id = 'mutated'; ctx.expectedProvider = consumer.did; resume();
  const r = await pending; assert.equal(r.accepted, true); assert.equal(r.snapshot.payload.item_id, 'item-1'); assert.equal(Object.isFrozen(r.snapshot.payload), true);
  assert.throws(() => { r.snapshot.payload.item_id = 'x'; });
  const denied = await api.acceptProtocolInput({ kind: 'value', value: r.snapshot }, { ...ctx, expectedProvider: provider.did, resolveAuthor: async () => { throw new Error('private secret'); } });
  assert.equal(denied.errors[0].code, 'SIGNATURE_INVALID'); assert.equal(JSON.stringify(denied.errors).includes('private secret'), false);
});
test('anchors are not part of consumer signed OPEN identity or trust', async () => {
  const c = await licenseChain(), ctx = await consumerContext(c);
  c[0].anchors = [{ type: 'opaque', reference: 'anything' }];
  const r = await accept(c, ctx); assert.equal(r.accepted, true); assert.equal(r.guarantees.anchors, 'not-checked');
});
test('invalid received signature and invalid manifest cannot masquerade as trusted context', async () => {
  const c = await licenseChain(), ctx = await consumerContext(c);
  const wrong = structuredClone(c); wrong[2].signature = 'ed25519:'+'0'.repeat(128);
  assert.equal((await accept(wrong, ctx)).errors[0].code, 'SIGNATURE_INVALID');
  ctx.manifest = { ...ctx.manifest, signature: 'ed25519:'+'0'.repeat(128) };
  assert.equal((await accept(c, ctx)).errors[0].code, 'SIGNATURE_INVALID');
});
test('reason metadata, arbitrary attestation authors and root parent are bounded', async () => {
  const c = await licenseChain();
  c.push(await sign({ type: 'status.update', request_id: request.request_id, status: 'REVOKED' }, undefined, provider, { in_reply_to: c[2].payload_hash }));
  assert.equal((await accept(c, chainContext)).errors[0].code, 'TRANSITION_INVALID');
  const root = await sign({ type: 'status.update', status: 'GRANTED', subject: { id: 's' }, policy: { ref: 'p' } });
  const next = await sign(root.payload, undefined, provider, { in_reply_to: root.payload_hash });
  assert.equal((await accept([root,next], { operation: 'attestation-chain', purpose: 'protocol-conformance' })).errors[0].code, 'AUTHORITY_MISMATCH');
  assert.equal((await accept(next, { operation: 'attestation-root', purpose: 'protocol-conformance' })).errors[0].code, 'ROOT_INVALID');
});
test('deterministic primary-cause table for simultaneous faults', async () => {
  const rows = [];
  for (const [name, expected, make] of [
    ['schema-before-hash', 'SCHEMA_INVALID', async () => ({ ...(await sign(request,'not-a-date')), payload_hash: terms })],
    ['hash-before-signature', 'HASH_MISMATCH', async () => { const e = await sign(); e.payload.item_id = 'tampered'; e.signature = 'ed25519:'+'0'.repeat(128); return e; }],
    ['signature-before-authority', 'SIGNATURE_INVALID', async () => ({ ...(await sign(request,undefined,provider)), signature: 'ed25519:'+'0'.repeat(128) })],
    ['authority-before-root', 'AUTHORITY_MISMATCH', async () => sign(request,undefined,provider,{ in_reply_to: terms })],
    ['root-before-provider-context', 'ROOT_INVALID', async () => sign({ ...request, provider_id: consumer.did },undefined,consumer,{ in_reply_to: terms })],
    ['known-open', null, async () => sign()],
  ]) {
    const r = await accept(await make()); assert.equal(r.errors[0]?.code ?? null, expected, name);
    rows.push({ name, expected, operation: r.operation, purpose: r.purpose, accepted: r.accepted, checks: r.checks, errors: r.errors, ingress: r.ingress });
  }
  for (const [name, expected, payload, extra] of [
    ['parent-before-request-transition', 'PARENT_MISMATCH', { type: 'status.update', request_id: 'foreign', status: 'GRANTED' }, { in_reply_to: terms }],
    ['request-before-transition', 'CONTEXT_MISMATCH', { type: 'status.update', request_id: 'foreign', status: 'GRANTED' }, null],
    ['transition-only', 'TRANSITION_INVALID', { type: 'status.update', request_id: request.request_id, status: 'GRANTED' }, null]
  ]) {
    const open = await sign(); const next = await sign(payload,undefined,provider, extra ?? { in_reply_to: open.payload_hash });
    const r = await accept([open,next],chainContext); assert.equal(r.errors[0].code,expected,name);
    rows.push({ name, expected, operation: r.operation, purpose: r.purpose, accepted: r.accepted, checks: r.checks, errors: r.errors, ingress: r.ingress });
  }
  if (process.env.H1A_ACCEPTANCE_RECORD) writeFileSync(process.env.H1A_ACCEPTANCE_RECORD,JSON.stringify({ count: rows.length, precedence: ['ingress','configuration-shape','schema-all','hash-all','signature-all','authority-all','root','mode-parent-request-transition-per-index','application-context','policy-excluded'], rows },null,2)+'\n');
});
const attestationContext = operation => ({ operation, purpose: 'protocol-conformance' });
const attestationPayload = (status, reason) => ({ type: 'status.update', status, subject: { id: 'subject' }, policy: { ref: 'policy' }, ...(reason === undefined ? {} : { reason }) });
for (const status of ['SUSPENDED', 'REVOKED']) {
  for (const [label, reason] of [['missing', undefined], ['empty', ''], ['whitespace', ' \t\n ']]) {
    for (const location of ['root', 'chain-root', 'chain-next']) {
      test(`Mode B reason strict reject ${status} ${label} ${location}`, async () => {
        const bad = await sign(attestationPayload(status, reason));
        let value = bad, operation = 'attestation-root', index;
        if (location === 'chain-root') { value = [bad]; operation = 'attestation-chain'; index = 0; }
        if (location === 'chain-next') {
          const root = await sign(attestationPayload('DENIED'));
          value = [root, await sign(bad.payload, undefined, consumer, { in_reply_to: root.payload_hash })];
          operation = 'attestation-chain'; index = 1;
        }
        const r = await accept(value, attestationContext(operation));
        assert.equal(r.accepted, false);
        assert.deepEqual(r.errors, [{ code: label === 'empty' ? 'SCHEMA_INVALID' : 'TRANSITION_INVALID', path: (index === undefined ? '' : `/${index}`) + '/payload/reason', ...(index === undefined ? {} : { index }) }]);
        assert.equal(r.checks[label === 'empty' ? 'schema' : 'context'], 'fail');
        assert.equal(r.checks.signature, label === 'empty' ? 'not-checked' : 'pass');
      });
    }
  }
  test(`Mode B meaningful reason root and every chain position ${status}`, async () => {
    const root = await sign(attestationPayload(status, ' \tfor cause\n '));
    const next = await sign(attestationPayload(status, 'next cause'), undefined, consumer, { in_reply_to: root.payload_hash });
    assert.equal((await accept(root, attestationContext('attestation-root'))).accepted, true);
    assert.equal((await accept([root,next], attestationContext('attestation-chain'))).accepted, true);
    const bad = await sign(attestationPayload(status), undefined, consumer, { in_reply_to: next.payload_hash });
    assert.deepEqual((await accept([root,next,bad], attestationContext('attestation-chain'))).errors, [{ code: 'TRANSITION_INVALID', path: '/2/payload/reason', index: 2 }]);
  });
  test(`license Mode A existing reason controls ${status}`, async () => {
    for (const reason of [undefined, '', ' \t\n ', 'for cause']) {
      const c = await licenseChain();
      c.push(await sign({ type: 'status.update', request_id: request.request_id, status, ...(reason === undefined ? {} : { reason }) }, undefined, provider, { in_reply_to: c[2].payload_hash }));
      const r = await accept(c, chainContext);
      assert.equal(r.accepted, reason === 'for cause');
      if (reason !== 'for cause') assert.equal(r.errors[0].code, reason === '' ? 'SCHEMA_INVALID' : 'TRANSITION_INVALID');
    }
  });
}
test('Mode B arbitrary author and free constant subject history remain unchanged', async () => {
  for (const key of [consumer, provider]) {
    const history = [];
    for (const status of ['REVOKED', 'GRANTED', 'DENIED', 'PENDING', 'SUSPENDED', 'GRANTED']) {
      history.push(await sign(attestationPayload(status, ['SUSPENDED','REVOKED'].includes(status) ? 'cause' : undefined), undefined, key, history.length ? { in_reply_to: history.at(-1).payload_hash } : {}));
    }
    assert.equal((await accept(history, attestationContext('attestation-chain'))).accepted, true);
    const wrongSubject = await sign({ ...attestationPayload('DENIED'), subject: { id: 'other' } }, undefined, key, { in_reply_to: history.at(-1).payload_hash });
    assert.equal((await accept([...history,wrongSubject], attestationContext('attestation-chain'))).errors[0].code, 'CONTEXT_MISMATCH');
    const wrongAuthor = await sign(attestationPayload('DENIED'), undefined, key === consumer ? provider : consumer, { in_reply_to: history.at(-1).payload_hash });
    assert.equal((await accept([...history,wrongAuthor], attestationContext('attestation-chain'))).errors[0].code, 'AUTHORITY_MISMATCH');
  }
});
test('Mode B reason primary-cause precedence stays deterministic', async () => {
  const rows = [];
  const root = await sign(attestationPayload('DENIED'));
  for (const [name, expected, payload, key, parent] of [
    ['authority-before-reason', 'AUTHORITY_MISMATCH', attestationPayload('SUSPENDED'), provider, root.payload_hash],
    ['parent-before-reason', 'PARENT_MISMATCH', attestationPayload('SUSPENDED'), consumer, terms],
    ['subject-before-reason', 'CONTEXT_MISMATCH', { ...attestationPayload('SUSPENDED'), subject: { id: 'other' } }, consumer, root.payload_hash],
    ['reason-only', 'TRANSITION_INVALID', attestationPayload('SUSPENDED'), consumer, root.payload_hash]
  ]) {
    const next = await sign(payload, undefined, key, { in_reply_to: parent });
    const r = await accept([root,next], attestationContext('attestation-chain'));
    assert.equal(r.accepted, false); assert.equal(r.errors[0].code, expected); assert.equal(r.errors[0].index, 1);
    rows.push({ name, expected, errors: r.errors, checks: r.checks });
  }
  if (process.env.H1A_REASON_RECORD) writeFileSync(process.env.H1A_REASON_RECORD, JSON.stringify({ count: rows.length, rows }, null, 2)+'\n');
});
test('valid OPEN positive control has visible value ingress limits', async () => {
  const r = await accept(await sign());
  assert.equal(r.accepted, true); assert.equal(r.ingress.rawEncoding, 'not-checked'); assert.equal(r.ingress.duplicateKeys, 'not-checked');
});
