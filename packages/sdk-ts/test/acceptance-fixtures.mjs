// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
// Stable schema/format corpus: no schema/source normalization and no crypto claim.
const hash = 'sha256:'+'0'.repeat(64), sig = 'ed25519:'+'0'.repeat(128);
const open = { type: 'license.request', request_id: 'r', consumer: { id: 'did:key:x' }, provider_id: 'did:key:p', item_id: 'i', license_type: 'l', terms_hash: hash, status: 'OPEN' };
const manifest = { type: 'manifest', provider: { id: 'did:key:p' }, request_endpoint: 'https://p.test/request', catalog_endpoint: 'https://p.test/catalog', license_types: [{ id: 'l', terms_url: 'https://p.test/terms', terms_hash: hash, scope: ['commercial-use'] }] };
const status = { type: 'status.update', request_id: 'r', status: 'GRANTED' };
const envelope = { proofmeta: '1.0', payload: open, payload_hash: hash, author: 'did:key:x', signature: sig, timestamp: '2026-01-01T00:00:00Z' };
export const validatorFixtures = [];
const add = (name, schema, value, expected) => validatorFixtures.push({ name, schema, value, expected });
for (const [schema, base] of Object.entries({ envelope, manifest, licenseRequest: open, statusUpdate: status })) {
  add(`${schema}/valid`, schema, base, true);
  for (const [name,v] of Object.entries({ null: null, array: [], number: 0, string: 'x' })) add(`${schema}/${name}`,schema,v,false);
  for (const key of Object.keys(base)) {
    const value = structuredClone(base); delete value[key];
    add(`${schema}/missing-${key}`, schema, value, false);
  }
}
for (const stamp of ['2026-01-01T00:00:00Z','2026-01-01t00:00:00z','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00.123456Z','2026-01-01T00:00:00-00:00','2026-01-01T00:00:00+03:00','2026-12-31T23:59:60Z','not-a-date','2026-02-30T00:00:00Z','2026-01-01','2026-01-01T24:00:00Z']) add(`envelope/date-${stamp}`, 'envelope', { ...envelope, timestamp: stamp });
for (const uri of ['https://p.test/terms','http://p.test/terms','mailto:x@y.test','urn:example:terms','https://[::1]/terms','relative','https://p.test/a b','']) {
  const value = structuredClone(manifest); value.license_types[0].terms_url = uri;
  add(`manifest/uri-${uri}`, 'manifest', value);
}
for (const signature of [sig.toUpperCase(),'ed25519:00','ed25519:'+'g'.repeat(128)]) add(`envelope/signature-${signature.slice(0,20)}`, 'envelope', { ...envelope, signature }, false);
for (const payload of [{ ...status, request_id: '' }, { type: 'status.update', status: 'GRANTED' }, { ...status, subject: { id: 's' }, policy: { ref: 'p' } }, { type: 'status.update', status: 'GRANTED', subject: { id: 's' }, policy: { ref: '' } }]) add(`statusUpdate/invalid-mode-${validatorFixtures.length}`, 'statusUpdate', payload, false);
add('statusUpdate/modeB', 'statusUpdate', { type: 'status.update', status: 'REVOKED', subject: { id: 's' }, policy: { ref: 'p', scope: ['unresolved'] } }, true);
add('statusUpdate/valid_until-nonUTC', 'statusUpdate', { ...status, valid_until: '2099-01-01T00:00:00+03:00' }, true);
add('statusUpdate/invalid-valid_until', 'statusUpdate', { ...status, valid_until: 'not-a-date' }, false);
add('envelope/anchors', 'envelope', { ...envelope, anchors: [{ type: 'opaque', reference: 'anything' }] }, true);
add('envelope/empty-anchors', 'envelope', { ...envelope, anchors: [] }, false);
add('manifest/both-catalogs', 'manifest', { ...manifest, items: [] }, false);
add('manifest/scope-empty', 'manifest', { ...manifest, license_types: [{ ...manifest.license_types[0], scope: [] }] }, false);
