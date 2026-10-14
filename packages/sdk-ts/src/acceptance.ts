// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { JsonIngressError, parseProtocolJson, snapshotJsonValue } from './json-ingress.js';
import type { JsonValue } from './json-ingress.js';
import * as ed25519 from '@noble/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { decodeDidKey, isDidKeyEd25519 } from './did-key.js';
import { hashPayload } from './hash.js';
import { jcs } from './jcs.js';
import { validateManifestScope } from './scope.js';
import { validateTransition, statusFromEnvelope } from './lifecycle.js';
import type { Envelope, AnyPayload, LicenseRequestPayload, StatusUpdatePayload } from './types.js';
import * as validators from './acceptance-validators.js';
import type { AcceptanceContext, AcceptanceSource, AcceptanceReport, AcceptanceCode, AcceptanceCheck } from './acceptance-types.js';
export { parseProtocolJson, JsonIngressError } from './json-ingress.js';
export type { JsonValue } from './json-ingress.js';
export type * from './acceptance-types.js';
function freeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      for (const child of Object.values(v)) stack.push(child);
      Object.freeze(v);
    }
  }
  return value;
}
function projection(env: Envelope) {
  return { proofmeta: env.proofmeta, payload_hash: env.payload_hash, author: env.author, timestamp: env.timestamp, ...(env.in_reply_to === undefined ? {} : { in_reply_to: env.in_reply_to }) };
}
function payloadValidator(env: Envelope<AnyPayload>) {
  return env.payload.type === 'manifest' ? validators.manifest : env.payload.type === 'license.request' ? validators.licenseRequest : env.payload.type === 'status.update' ? validators.statusUpdate : undefined;
}
function modeB(env: Envelope<AnyPayload>): boolean {
  return env.payload.type === 'status.update' && env.payload.request_id === undefined && env.payload.subject !== undefined && env.payload.policy !== undefined;
}
function missingAttestationReason(env: Envelope<AnyPayload>): boolean {
  return env.payload.type === 'status.update' && (env.payload.status === 'SUSPENDED' || env.payload.status === 'REVOKED')
    && (typeof env.payload.reason !== 'string' || env.payload.reason.trim().length === 0);
}
/** Detached source/context before the first await. No anchor, scope or use grant. */
export async function acceptProtocolInput(source: AcceptanceSource, context: AcceptanceContext): Promise<AcceptanceReport> {
  let c: AcceptanceContext | undefined;
  let resolveAuthor: AcceptanceContext['resolveAuthor'];
  try {
    if (!context || typeof context !== 'object') throw new Error('Missing context');
    const descriptors = Object.getOwnPropertyDescriptors(context);
    const resolver = descriptors.resolveAuthor;
    if (resolver) {
      if (!('value' in resolver) || typeof resolver.value !== 'function') throw new Error('Invalid resolver');
      resolveAuthor = resolver.value; delete descriptors.resolveAuthor;
    }
    c = freeze(snapshotJsonValue(Object.create(Object.getPrototypeOf(context), descriptors))) as unknown as AcceptanceContext;
  } catch { /* Required context failure is reported, not thrown. */ }
  const validContext = !!c && ['manifest','provider-open','license-chain','attestation-root','attestation-chain','inspect-envelope'].includes(c.operation) && (c.operation === 'inspect-envelope' ? c.purpose === 'inspection' : c.purpose === 'protocol-conformance' || (c.operation === 'license-chain' && c.purpose === 'consumer-response'));
  const report: Omit<AcceptanceReport, 'accepted' | 'operation' | 'purpose'> & { operation: AcceptanceContext['operation']; purpose: AcceptanceContext['purpose']; accepted: boolean } = { reportVersion: 1, operation: validContext ? c!.operation : 'inspect-envelope', purpose: validContext ? c!.purpose : 'inspection', accepted: false,
    checks: { ingress: 'not-checked', schema: 'not-checked', hash: 'not-checked', signature: 'not-checked', authority: 'not-checked', context: 'not-checked', policy: 'not-checked' },
    ingress: { kind: source?.kind === 'bytes' ? 'bytes' : 'value', rawEncoding: 'not-checked', duplicateKeys: 'not-checked' }, errors: [],
    exclusions: { policyScope: 'unresolved-excluded', manifestScope: 'not-checked' },
    guarantees: { anchors: 'not-checked', trustedTime: 'not-checked', operationalAuthorization: false } };
  const reject = (check: AcceptanceCheck, code: AcceptanceCode, path = '', index?: number, position?: number) => {
    report.checks[check] = 'fail'; report.errors.push({ code, path, ...(index === undefined ? {} : { index }), ...(position === undefined ? {} : { position }) }); return freeze(report) as AcceptanceReport;
  };
  let value: JsonValue;
  try {
    if (!source || (source.kind !== 'bytes' && source.kind !== 'value')) throw new Error('Invalid source');
    if (source.kind === 'bytes' && !(source.bytes instanceof Uint8Array)) throw new Error('Invalid bytes');
    value = source.kind === 'bytes' ? parseProtocolJson(new Uint8Array(source.bytes)) : snapshotJsonValue(source.value);
    report.snapshot = freeze(value); report.checks.ingress = 'pass';
    if (source.kind === 'bytes') { report.ingress.rawEncoding = 'pass'; report.ingress.duplicateKeys = 'pass'; }
  } catch (e) {
    if (source?.kind === 'bytes' && e instanceof JsonIngressError) {
      report.ingress.rawEncoding = e.code === 'UTF8_INVALID' || e.code === 'BOM_UNSUPPORTED' ? 'fail' : 'pass';
      report.ingress.duplicateKeys = e.code === 'JSON_DUPLICATE_KEY' ? 'fail' : e.code === 'JSON_DOMAIN' ? 'pass' : 'not-checked';
    }
    return reject('ingress', e instanceof JsonIngressError ? e.code : 'JSON_DOMAIN', '', undefined, e instanceof JsonIngressError ? e.position : undefined);
  }
  if (!validContext || !c) return reject('context', 'CONTEXT_REQUIRED', '/context');
  const chain = c.operation === 'license-chain' || c.operation === 'attestation-chain';
  if (chain && (!Array.isArray(value) || !value.length)) return reject('context', 'ROOT_INVALID');
  const envelopes = (chain ? value : [value]) as unknown as Envelope<AnyPayload>[];
  type Entry = { env: Envelope<AnyPayload>; prefix: string; index?: number };
  const entries: Entry[] = envelopes.map((env, index) => ({ env, prefix: chain ? `/${index}` : '', ...(chain ? { index } : {}) }));
  // Consumer evidence is detached before awaits and checked in the same phases.
  if (c.operation === 'license-chain' && c.purpose === 'consumer-response') {
    if (c.sentOpen !== undefined && c.sentOpen !== null) entries.push({ env: c.sentOpen as Envelope<AnyPayload>, prefix: '/context/sentOpen' });
    if (c.manifest !== undefined && c.manifest !== null) entries.push({ env: c.manifest as Envelope<AnyPayload>, prefix: '/context/manifest' });
  }
  for (const { env, prefix, index } of entries) {
    if (!validators.envelope(env)) return reject('schema', 'SCHEMA_INVALID', prefix + (validators.envelope.errors?.[0]?.instancePath ?? ''), index);
    const validator = payloadValidator(env);
    if (!validator && c.operation !== 'inspect-envelope') return reject('schema', 'PAYLOAD_UNSUPPORTED', prefix + '/payload/type', index);
    if (validator && !validator(env.payload)) return reject('schema', 'SCHEMA_INVALID', prefix + '/payload' + (validator.errors?.[0]?.instancePath ?? ''), index);
    if (!/(?:[Zz]|\+00:00)$/.test(env.timestamp)) return reject('schema', 'SCHEMA_INVALID', prefix + '/timestamp', index);
  }
  report.checks.schema = 'pass';
  for (const { env, prefix, index } of entries) {
    if (hashPayload(env.payload) !== env.payload_hash) return reject('hash', 'HASH_MISMATCH', prefix + '/payload_hash', index);
  }
  report.checks.hash = 'pass';
  for (const { env, prefix, index } of entries) {
    try {
      const key = isDidKeyEd25519(env.author) ? decodeDidKey(env.author) : resolveAuthor ? await resolveAuthor(env.author) : undefined;
      if (!key || !await ed25519.verifyAsync(hexToBytes(env.signature.slice(8)), new TextEncoder().encode(jcs(projection(env))), key)) return reject('signature', 'SIGNATURE_INVALID', prefix + '/signature', index);
    } catch { return reject('signature', 'SIGNATURE_INVALID', prefix + '/signature', index); }
  }
  report.checks.signature = 'pass';
  const root = envelopes[0];
  for (const { env, prefix, index } of entries) {
    if ((env.payload.type === 'manifest' && env.author !== env.payload.provider.id) || (env.payload.type === 'license.request' && env.author !== env.payload.consumer.id)
      || (c.operation === 'license-chain' && index !== undefined && index > 0 && root.payload.type === 'license.request' && env.payload.type === 'status.update' && env.author !== root.payload.provider_id)
      || (c.operation === 'attestation-chain' && index !== undefined && index > 0 && modeB(env) && env.author !== root.author)) return reject('authority', 'AUTHORITY_MISMATCH', prefix + '/author', index);
  }
  report.checks.authority = c.operation === 'inspect-envelope' && !payloadValidator(root) ? 'not-applicable' : 'pass';
  if (c.operation === 'inspect-envelope') { report.checks.context = 'not-applicable'; return freeze(report) as AcceptanceReport; }
  if (root.in_reply_to !== undefined) return reject('context', 'ROOT_INVALID', (chain ? '/0' : '') + '/in_reply_to', chain ? 0 : undefined);
  if (c.operation === 'manifest' && root.payload.type !== 'manifest') return reject('context', 'MODE_INVALID', '/payload/type');
  if (c.operation === 'provider-open' && root.payload.type !== 'license.request') return reject('context', 'MODE_INVALID', '/payload/type');
  if (c.operation === 'license-chain' && root.payload.type !== 'license.request') return reject('context', 'ROOT_INVALID', '/0/payload/type', 0);
  if ((c.operation === 'attestation-root' || c.operation === 'attestation-chain') && !modeB(root)) return reject('context', 'MODE_INVALID', (chain ? '/0' : '') + '/payload', chain ? 0 : undefined);
  if ((c.operation === 'attestation-root' || c.operation === 'attestation-chain') && missingAttestationReason(root)) return reject('context', 'TRANSITION_INVALID', (chain ? '/0' : '') + '/payload/reason', chain ? 0 : undefined);
  for (let i = 1; i < envelopes.length; i++) {
    const env = envelopes[i];
    if (c.operation === 'license-chain' ? env.payload.type !== 'status.update' || modeB(env) : !modeB(env)) return reject('context', 'MODE_INVALID', `/${i}/payload`, i);
    if (env.in_reply_to !== envelopes[i-1].payload_hash) return reject('context', 'PARENT_MISMATCH', `/${i}/in_reply_to`, i);
    if (c.operation === 'license-chain') {
      if ((env.payload as StatusUpdatePayload).request_id !== (root.payload as LicenseRequestPayload).request_id) return reject('context', 'CONTEXT_MISMATCH', `/${i}/payload/request_id`, i);
      if (!validateTransition(statusFromEnvelope(envelopes[i-1])!, env).ok) return reject('context', 'TRANSITION_INVALID', `/${i}/payload/status`, i);
    } else if ((env.payload as StatusUpdatePayload).subject!.id !== (root.payload as StatusUpdatePayload).subject!.id) return reject('context', 'CONTEXT_MISMATCH', `/${i}/payload/subject/id`, i);
    if (c.operation === 'attestation-chain' && missingAttestationReason(env)) return reject('context', 'TRANSITION_INVALID', `/${i}/payload/reason`, i);
  }
  if (c.operation === 'provider-open') {
    if (typeof c.expectedProvider !== 'string' || !c.expectedProvider.length) return reject('context', 'CONTEXT_REQUIRED', '/context/expectedProvider');
    if ((root.payload as LicenseRequestPayload).provider_id !== c.expectedProvider) return reject('context', 'CONTEXT_MISMATCH', '/payload/provider_id');
  }
  if (c.operation === 'license-chain' && c.purpose === 'consumer-response') {
    for (const key of ['sentOpen','expectedProvider','manifest','item','licenseType','termsHash'] as const) {
      if (c[key] === undefined || c[key] === null || c[key] === '') return reject('context', 'CONTEXT_REQUIRED', `/context/${key}`);
    }
    const sent = c.sentOpen as Envelope<AnyPayload>, manifest = c.manifest as Envelope<AnyPayload>;
    if (sent.payload.type !== 'license.request' || sent.in_reply_to !== undefined) return reject('context', 'ROOT_INVALID', '/context/sentOpen');
    if (manifest.payload.type !== 'manifest' || manifest.in_reply_to !== undefined) return reject('context', 'ROOT_INVALID', '/context/manifest');
    if (root.payload_hash !== sent.payload_hash || jcs(projection(root)) !== jcs(projection(sent))) return reject('context', 'CONTEXT_MISMATCH', '/0');
    if (typeof c.expectedProvider !== 'string' || (root.payload as LicenseRequestPayload).provider_id !== c.expectedProvider || manifest.payload.provider.id !== c.expectedProvider) return reject('context', 'CONTEXT_MISMATCH', '/context/expectedProvider');
    const item = c.item as { item_id?: unknown; available_licenses?: unknown };
    if (typeof item !== 'object' || Array.isArray(item) || typeof item.item_id !== 'string' || !Array.isArray(item.available_licenses)) return reject('context', 'CONTEXT_MISMATCH', '/context/item');
    if ((root.payload as LicenseRequestPayload).item_id !== item.item_id || !item.available_licenses.includes(c.licenseType)) return reject('context', 'CONTEXT_MISMATCH', '/context/item');
    const selected = manifest.payload.license_types.find((l: { id: string }) => l.id === c.licenseType);
    if (!selected || (root.payload as LicenseRequestPayload).license_type !== c.licenseType) return reject('context', 'CONTEXT_MISMATCH', '/context/licenseType');
    if ((root.payload as LicenseRequestPayload).terms_hash !== c.termsHash || selected.terms_hash !== c.termsHash) return reject('context', 'CONTEXT_MISMATCH', '/context/termsHash');
    if (manifest.payload.items) {
      const declared = manifest.payload.items.find((i: { item_id: string }) => i.item_id === item.item_id);
      if (!declared || !declared.available_licenses.includes(c.licenseType)) return reject('context', 'CONTEXT_MISMATCH', '/context/item');
    }
  }
  let checkedManifestScope = false;
  for (const { env, prefix, index } of entries) {
    if (env.payload.type !== 'manifest') continue;
    checkedManifestScope = true;
    for (let i = 0; i < env.payload.license_types.length; i++) {
      const result = validateManifestScope(env.payload.license_types[i].scope);
      if (!result.ok) {
        report.exclusions.manifestScope = 'fail';
        return reject('context', 'SCOPE_INVALID', prefix + `/payload/license_types/${i}/scope` + (result.index === undefined ? '' : `/${result.index}`), index);
      }
    }
  }
  report.exclusions.manifestScope = checkedManifestScope ? 'pass' : 'not-applicable';
  report.checks.context = 'pass'; report.accepted = true;
  return freeze(report) as AcceptanceReport;
}
