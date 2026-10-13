// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptProtocolInput } from '@proofmeta/sdk-ts/acceptance';

const cliBin = new URL('../bin/proofmeta.mjs', import.meta.url).pathname;
function withFiles(source, context, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'proofmeta-cli-'));
  try {
    const file = join(dir, 'source.json'), contextFile = join(dir, 'context.json');
    writeFileSync(file, source);
    if (context !== undefined) writeFileSync(contextFile, context);
    return callback(file, contextFile);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function invoke(args) {
  return spawnSync(process.execPath, [...process.execArgv.filter(a => a === '--experimental-global-webcrypto'), cliBin, ...args], { encoding: 'utf8' });
}
test('accept raw duplicate preserves SDK code and raw-byte rejection exit', async () => {
  const bytes = new TextEncoder().encode('{"a":1,"a":2}');
  const context = { operation: 'manifest', purpose: 'protocol-conformance' };
  const sdk = await acceptProtocolInput({ kind: 'bytes', bytes }, context);
  withFiles(bytes, undefined, file => {
    const result = invoke(['accept', file, '--operation', context.operation, '--purpose', context.purpose]);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.accepted, sdk.accepted);
    assert.deepEqual(report.errors, sdk.errors);
    assert.deepEqual(report.checks, sdk.checks);
  });
});

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

import { keyPairFromPrivate, createEnvelope } from '@proofmeta/sdk-ts';
import { scopeCases } from '../../sdk-ts/test/scope-fixtures.mjs';
const provider = await keyPairFromPrivate(new Uint8Array(32).fill(41));
const consumer = await keyPairFromPrivate(new Uint8Array(32).fill(42));
const termsHash = 'sha256:' + '0'.repeat(64);
const sign = (payload, key = provider, extra = {}) => createEnvelope({ payload, author: key.did, privateKey: key.privateKey, timestamp: '2026-01-01T00:00:00Z', ...extra });
const manifestPayload = scope => ({ type: 'manifest', provider: { id: provider.did }, request_endpoint: 'https://p.test/request', catalog_endpoint: 'https://p.test/catalog', license_types: [{ id: 'l', terms_url: 'https://p.test/terms', terms_hash: termsHash, scope }] });
const open = await sign({ type: 'license.request', request_id: 'r', consumer: { id: consumer.did }, provider_id: provider.did, item_id: 'i', license_type: 'l', terms_hash: termsHash, status: 'OPEN' }, consumer);
const manifest = await sign(manifestPayload(['commercial']));
const responseContext = { operation: 'license-chain', purpose: 'consumer-response', sentOpen: open, expectedProvider: provider.did, manifest, item: { item_id: 'i', available_licenses: ['l'] }, licenseType: 'l', termsHash };
async function parity(value, context, extraArgs = []) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
  const sdk = await acceptProtocolInput({ kind: 'bytes', bytes }, context);
  withFiles(bytes, JSON.stringify(context), (file, contextFile) => {
    const result = invoke(['accept', file, '--operation', context.operation, '--purpose', context.purpose, '--context', contextFile, ...extraArgs]);
    assert.equal(result.status, sdk.accepted ? 0 : 1, result.stderr);
    const cli = JSON.parse(result.stdout);
    assert.equal(cli.accepted, sdk.accepted);
    assert.deepEqual(cli.errors, sdk.errors);
    assert.deepEqual(cli.checks, sdk.checks);
    assert.deepEqual(cli.ingress, sdk.ingress);
    assert.deepEqual(cli.exclusions, sdk.exclusions);
    assert.deepEqual(cli.guarantees, sdk.guarantees);
  });
  return sdk;
}
test('accept context file binds consumer response using the same SDK operation', async () => {
  assert.equal((await parity([open], responseContext)).accepted, true);
});

test('validate raw duplicate is a stable diagnostic rejection without authority claim', () => {
  withFiles('{"a":1,"a":2}', undefined, file => {
    const r = invoke(['validate', file, '--json']);
    assert.equal(r.status, 1, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.errors[0].code, 'JSON_DUPLICATE_KEY');
    assert.equal(report.accepted, false);
    assert.equal(report.guarantees.operationalAuthorization, false);
  });
});

import { validatorFixtures } from '../../sdk-ts/test/acceptance-fixtures.mjs';
import { validateInput, validateBytes } from '../src/validate.mjs';
const rawFixtures = JSON.parse(readFileSync(new URL('../../sdk-ts/test/fixtures/strict-json/cases.json', import.meta.url)));
for (const c of rawFixtures) test(`raw parity: ${c.name}`, async () => {
  const sdk = await parity(new TextEncoder().encode(c.raw), { operation: 'manifest', purpose: 'protocol-conformance' });
  assert.equal(sdk.errors[0].code, c.code);
});
for (const [name, bytes] of [['UTF8_INVALID', new Uint8Array([0xff])], ['BOM_UNSUPPORTED', new Uint8Array([0xef,0xbb,0xbf,123,125])]]) test(`raw parity: ${name}`, async () => {
  assert.equal((await parity(bytes, { operation: 'manifest', purpose: 'protocol-conformance' })).errors[0].code, name);
});
for (const c of scopeCases) test(`signed scope parity: ${c.name}`, async () => {
  const value = await sign(manifestPayload(c.scope));
  const context = { operation: 'manifest', purpose: 'protocol-conformance' };
  const sdk = await parity(value, context);
  assert.equal(sdk.errors[0]?.code ?? null, c.code);
  const valueSdk = await acceptProtocolInput({ kind: 'value', value }, context);
  const diagnostic = await validateInput(value);
  assert.equal(diagnostic.ok, valueSdk.accepted);
  assert.deepEqual(diagnostic.errors, valueSdk.errors);
  assert.equal(diagnostic.accepted, false);
  assert.equal(diagnostic.ingress.rawEncoding, 'not-checked');
  const rawDiagnostic = await validateBytes(new TextEncoder().encode(JSON.stringify(value)));
  assert.equal(rawDiagnostic.ok, sdk.accepted);
  assert.deepEqual(rawDiagnostic.errors, sdk.errors);
  await parity([open], { ...responseContext, manifest: value });
});
for (const c of validatorFixtures) test(`schema parity: ${c.name}`, async () => {
  const value = c.schema === 'envelope' ? c.value : { ...manifest, payload: c.value };
  await parity(value, { operation: 'inspect-envelope', purpose: 'inspection' });
});
test('signed hash/signature/authority/context parity and offline Mode B', async () => {
  const context = { operation: 'manifest', purpose: 'protocol-conformance' };
  assert.equal((await parity({ ...manifest, payload_hash: 'sha256:' + 'f'.repeat(64) }, context)).errors[0].code, 'HASH_MISMATCH');
  assert.equal((await parity({ ...manifest, signature: 'ed25519:' + '0'.repeat(128) }, context)).errors[0].code, 'SIGNATURE_INVALID');
  assert.equal((await parity(await sign(manifest.payload, consumer), context)).errors[0].code, 'AUTHORITY_MISMATCH');
  assert.equal((await parity(open, { operation: 'provider-open', purpose: 'protocol-conformance' })).errors[0].code, 'CONTEXT_REQUIRED');
  assert.equal((await parity(open, { operation: 'provider-open', purpose: 'protocol-conformance', expectedProvider: consumer.did })).errors[0].code, 'CONTEXT_MISMATCH');
  const att = await sign({ type: 'status.update', status: 'GRANTED', subject: { id: 's' }, policy: { ref: 'p', scope: ['unresolved'] } });
  assert.equal((await parity(att, { operation: 'attestation-root', purpose: 'protocol-conformance' })).accepted, true);
  assert.equal((await parity([att], { operation: 'attestation-chain', purpose: 'protocol-conformance' })).accepted, true);
  assert.equal((await parity([], { operation: 'license-chain', purpose: 'protocol-conformance' })).errors[0].code, 'ROOT_INVALID');
});
test('unknown inspection remains accepted false, core acceptance rejects', async () => {
  const unknown = await sign({ type: 'extension.example', data: 1 });
  const inspect = await parity(unknown, { operation: 'inspect-envelope', purpose: 'inspection' });
  assert.equal(inspect.accepted, false);
  assert.deepEqual(inspect.errors, []);
  assert.equal((await parity(unknown, { operation: 'manifest', purpose: 'protocol-conformance' })).errors[0].code, 'PAYLOAD_UNSUPPORTED');
  const diagnostic = await validateInput(unknown);
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.accepted, false);
});
test('actual argv errors, context file errors and absent protocol evidence have distinct exits', () => {
  withFiles(JSON.stringify(open), undefined, (file, contextFile) => {
    const base = ['accept', file, '--operation', 'provider-open', '--purpose', 'protocol-conformance'];
    for (const args of [[], ['--context', contextFile]]) {
      const r = invoke([...base, ...args]);
      assert.equal(r.status, args.length ? 2 : 1, r.stderr);
      if (!args.length) assert.equal(JSON.parse(r.stdout).errors[0].code, 'CONTEXT_REQUIRED');
    }
    for (const raw of ['{', '{"a":1,"a":2}', 'null', '[]', '1', '{"operation":"manifest"}', '{"purpose":"inspection"}', '{"resolveAuthor":"x"}']) {
      writeFileSync(contextFile, raw);
      assert.equal(invoke([...base, '--context', contextFile]).status, 2, raw);
    }
    for (const args of [['accept', file], [...base, '--operation', 'manifest'], [...base, '--purpose'], [...base, '--unknown'], [...base, file], ['accept', file, '--operation', 'invalid', '--purpose', 'inspection'], ['accept', file, '--operation', 'manifest', '--purpose', 'inspection'], ['validate', file, '--unknown'], ['validate'], ['validate', file, file]]) assert.equal(invoke(args).status, 2, JSON.stringify(args));
    writeFileSync(file, '{');
    assert.equal(invoke(base).status, 1);
    assert.equal(invoke(['validate', file, '--json']).status, 2);
    writeFileSync(file, '[]');
    const empty = invoke(['validate', file, '--json']);
    assert.equal(empty.status, 1);
    const r = JSON.parse(empty.stdout);
    assert.equal(r.kind, 'chain');
    assert.deepEqual(r.envelopes, []);
    assert.equal(r.chain.ok, false);
    assert.equal(r.accepted, false);
  });
});

test('help and human diagnostics explicitly separate acceptance and inspection', () => {
  const help = invoke(['--help']);
  assert.match(help.stdout, /proofmeta accept/);
  assert.match(help.stdout, /--context/);
  withFiles(JSON.stringify(manifest), undefined, file => {
    const r = invoke(['validate', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /accepted=false/);
  });
});

test("--version matches the CLI package version", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("../bin/proofmeta.mjs", import.meta.url).pathname, "--version"],
    { encoding: "utf-8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `proofmeta ${packageJson.version}\n`);
});
