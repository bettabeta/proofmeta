// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, createEnvelope, keyPairFromPrivate } from '@proofmeta/sdk-ts';
import { acceptProtocolInput } from '@proofmeta/sdk-ts/acceptance';

const sign = (key, payload, extra = {}) => createEnvelope({ payload, author: key.did, privateKey: key.privateKey, timestamp: '2026-01-01T00:00:00Z', ...extra });
async function scenario(mode) {
  const provider = await generateKeyPair(), other = await generateKeyPair();
  let manifest, chain, context, gets = 0;
  let fixtureDir;
  const childOptions = [];
  const ownedFixtureKey = await keyPairFromPrivate(new Uint8Array(32).fill(7));
  if (mode === 'different-projection-post') {
    // Deterministic test key only: real client signing and verification remain
    // unchanged. Knowing this fixture seed lets the HTTP server produce a
    // separately valid signature over another D16 projection of the same payload.
    fixtureDir = await mkdtemp(join(tmpdir(), 'consumer-key-fixture-'));
    const preload = join(fixtureDir, 'seed.mjs');
    await writeFile(preload, 'globalThis.crypto.getRandomValues = bytes => bytes.fill(7);');
    childOptions.push('--import', preload);
  }
  const server = createServer(async (req, res) => {
    try {
      let body;
      if (req.url === '/.well-known/proofmeta.json') {
        body = manifest;
        if (mode === 'manifest-author') body = await sign(other, manifest.payload);
        if (mode === 'manifest-time') body = await sign(provider, manifest.payload, { timestamp: '2026-01-01T00:00:00-00:00' });
        if (mode === 'manifest-scope') body = await sign(provider, { ...manifest.payload, license_types: [{ ...manifest.payload.license_types[0], scope: ['commercial', 'relative'] }] });
      }
      else if (req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const sent = JSON.parse(Buffer.concat(chunks));
        context = { operation: 'license-chain', purpose: 'consumer-response', sentOpen: sent, expectedProvider: provider.did, manifest, item: manifest.payload.items[0], licenseType: 'free', termsHash: manifest.payload.license_types[0].terms_hash };
        let root = sent;
        if (mode === 'foreign-post') root = await sign(other, { ...sent.payload, consumer: { id: other.did } });
        const pending = await sign(provider, { type: 'status.update', request_id: sent.payload.request_id, status: 'PENDING' }, { in_reply_to: root.payload_hash });
        const granted = await sign(provider, { type: 'status.update', request_id: sent.payload.request_id, status: 'GRANTED', valid_until: '2099-01-01T00:00:00+03:00' }, { in_reply_to: pending.payload_hash });
        if (mode === 'anchors') root = { ...root, anchors: [{ type: 'opaque', reference: 'root-anchor' }] };
        if (mode === 'different-projection-post') {
          assert.equal(sent.author, ownedFixtureKey.did);
          root = await sign(ownedFixtureKey, sent.payload, { timestamp: '2026-01-02T00:00:00Z' });
        }
        chain = [root, pending, granted];
        if (mode === 'rollback-get') {
          const paused = await sign(provider, { ...granted.payload, status: 'SUSPENDED', reason: 'paused' }, { in_reply_to: granted.payload_hash });
          const resumed = await sign(provider, { ...granted.payload, reason: 'resumed' }, { in_reply_to: paused.payload_hash });
          chain.push(paused, resumed);
        }
        body = { chain };
        if (mode === 'post-wrapper-array') body = chain;
        if (mode === 'post-wrapper-null') body = null;
        if (mode === 'post-wrapper-empty') body = { chain: [] };
      } else {
        gets++; body = chain.at(-1);
        if (mode === 'attacker-get') body = await sign(other, body.payload, { in_reply_to: body.in_reply_to });
        if (mode === 'wrong-root-get') body = await sign(provider, body.payload, { in_reply_to: 'sha256:' + 'f'.repeat(64) });
        if (mode === 'rollback-get') body = chain[2];
        if (mode === 'continuation-get') body = await sign(provider, { ...body.payload, status: 'SUSPENDED', reason: 'paused' }, { in_reply_to: body.payload_hash });
        if (mode === 'anchors') body = { ...body, anchors: [{ type: 'opaque', reference: 'changed' }] };
      }
      const stage = req.url === '/.well-known/proofmeta.json' ? 'manifest' : req.method === 'POST' ? 'post' : 'get';
      let bytes = Buffer.from(JSON.stringify(body));
      if (mode === `${stage}-duplicate`) {
        const text = bytes.toString(); const key = stage === 'post' ? 'chain' : 'payload';
        bytes = Buffer.from(text.replace(`"${key}":`, `"${key}":null,"${key}":`));
      }
      if (mode === `${stage}-escaped`) bytes = Buffer.from(bytes.toString().replace('"proofmeta":', '"proofmeta":"wrong","proof\\u006deta":'));
      if (mode === `${stage}-nested`) {
        const key = stage === 'manifest' ? 'id' : 'request_id';
        bytes = Buffer.from(bytes.toString().replace(`"${key}":`, `"${key}":null,"${key}":`));
      }
      if (mode === `${stage}-bom`) bytes = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), bytes]);
      if (mode === `${stage}-utf8`) {
        const envelope = stage === 'post' ? body.chain[0] : body;
        envelope.anchors = [{ type: 'opaque', reference: 'invalidUTF8Marker' }];
        const text = JSON.stringify(body).split('invalidUTF8Marker');
        bytes = Buffer.concat([Buffer.from(text[0]), Buffer.from([0xc3,0x28]), Buffer.from(text[1])]);
      }
      res.setHeader('content-type', 'application/json'); res.end(bytes);
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  manifest = await sign(provider, { type: 'manifest', provider: { id: provider.did }, request_endpoint: `${origin}/requests`, items: [{ item_id: 'item', name: 'Item', available_licenses: ['free'] }], license_types: [{ id: 'free', terms_url: `${origin}/terms`, terms_hash: 'sha256:' + '0'.repeat(64), scope: ['commercial'] }] });
  try {
    const child = spawn(process.execPath, [...process.execArgv.filter(x => x === '--experimental-global-webcrypto'), ...childOptions, new URL('../client.mjs', import.meta.url).pathname], { env: { ...process.env, PROVIDER_ORIGIN: origin, ITEM_ID: 'item', LICENSE_TYPE: 'free' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timer);
    return { code, output, gets, chain, context };
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  }
}
for (const mode of ['attacker-get', 'wrong-root-get', 'rollback-get', 'continuation-get', 'different-projection-post', 'post-wrapper-array', 'post-wrapper-null', 'post-wrapper-empty', 'manifest-author', 'manifest-time', 'manifest-scope', ...['manifest','post','get'].flatMap(stage => ['duplicate','escaped','nested','bom','utf8'].map(kind => `${stage}-${kind}`))]) {
  test(`actual HTTP200 consumer rejects ${mode}`, async () => {
    const r = await scenario(mode); assert.equal(r.code, 1, r.output);
    if (mode.startsWith('post-') || mode === 'different-projection-post') assert.equal(r.gets, 0);
    if (mode === 'different-projection-post') {
      assert.equal(r.chain[0].payload_hash, r.context.sentOpen.payload_hash);
      assert.equal((await acceptProtocolInput({ kind: 'value', value: r.chain }, { operation: 'license-chain', purpose: 'protocol-conformance' })).accepted, true);
      assert.match(r.output, /CONTEXT_MISMATCH/);
    }
    if (['-duplicate','-escaped','-nested'].some(suffix => mode.endsWith(suffix))) assert.match(r.output, /JSON_DUPLICATE_KEY/);
    if (mode.endsWith('-bom')) assert.match(r.output, /BOM_UNSUPPORTED/);
    if (mode.endsWith('-utf8')) assert.match(r.output, /UTF8_INVALID/);
  });
}
for (const mode of ['legit', 'anchors']) {
  test(`actual HTTP200 consumer accepts ${mode}`, async () => {
    const r = await scenario(mode); assert.equal(r.code, 0, r.output); assert.equal(r.gets, 1);
  });
}
test('direct loopback consumer rejects an invalid manifest, without external calls', async () => {
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const child = spawn(process.execPath, [new URL('../client.mjs', import.meta.url).pathname], { env: { ...process.env, PROVIDER_ORIGIN: `http://127.0.0.1:${server.address().port}` }, stdio: ['ignore','pipe','pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
    const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); }); clearTimeout(timer);
    assert.equal(code, 1, output); assert.match(output, /manifest acceptance failed/);
    assert.doesNotMatch(output, /full Tier-1 flow completed OK/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('E2E collision fails before consumer and leaves the foreign listener alive', async () => {
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4101, '127.0.0.1', resolve); });
  try {
    const child = spawn(process.execPath, [...process.execArgv.filter(x => x === '--experimental-global-webcrypto'), new URL('../../../scripts/e2e.mjs', import.meta.url).pathname], { stdio: ['ignore','pipe','pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
    const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); }); clearTimeout(timer);
    assert.equal(code, 1, output); assert.match(output, /provider did not send owned-bound signal/);
    assert.match(output, /\[e2e\] FAIL/); assert.doesNotMatch(output, /\[e2e\] PASS/);
    assert.doesNotMatch(output, /running consumer|\[consumer\]/);
    assert.equal((await fetch('http://127.0.0.1:4101/.well-known/proofmeta.json', { signal: AbortSignal.timeout(1000) })).ok, true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('root test aggregates the actual consumer Node test framework', async () => {
  const root = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.test, /npm run test -w @proofmeta\/example-consumer(?: &&|$)/);
  assert.equal(pkg.scripts.test, 'node --test test/*.test.mjs');
});
test('SDK/CLI shared signed consumer-response context batches', async () => {
  const r = await scenario('legit');
  const consumer = await generateKeyPair();
  const sent = await sign(consumer, { ...r.context.sentOpen.payload, consumer: { id: consumer.did } });
  const provider = await generateKeyPair();
  const manifest = await sign(provider, { ...r.context.manifest.payload, provider: { id: provider.did } });
  const own = await sign(consumer, { ...sent.payload, provider_id: provider.did });
  const alternate = await sign(consumer, own.payload, { timestamp: '2026-01-02T00:00:00Z' });
  assert.equal(alternate.payload_hash, own.payload_hash);
  assert.notEqual(alternate.signature, own.signature);
  const pending = await sign(provider, r.chain[1].payload, { in_reply_to: own.payload_hash });
  const granted = await sign(provider, r.chain[2].payload, { in_reply_to: pending.payload_hash });
  const base = { ...r.context, sentOpen: own, expectedProvider: provider.did, manifest };
  const good = [own, pending, granted];
  const fixtures = [
    ['own', good, base, true],
    ['same-hash-different-D16', [alternate,pending,granted], base, false],
    ['provider', good, { ...base, expectedProvider: consumer.did }, false],
    ['item', good, { ...base, item: { ...base.item, item_id: 'foreign' } }, false],
    ['license', good, { ...base, licenseType: 'foreign' }, false],
    ['terms', good, { ...base, termsHash: 'sha256:' + 'f'.repeat(64) }, false],
    ['anchors', [{ ...own, anchors: [{ type: 'opaque', reference: 'new' }] },pending,granted], base, true],
  ];
  const dir = await mkdtemp(join(tmpdir(), 'consumer-parity-'));
  try {
    for (const [name, value, context, accepted] of fixtures) {
      const sdk = await acceptProtocolInput({ kind: 'bytes', bytes: Buffer.from(JSON.stringify(value)) }, context);
      assert.equal(sdk.accepted, accepted, name);
      const { acceptConsumerResponse } = await import('../acceptance.mjs');
      const consumerReport = await acceptConsumerResponse(Buffer.from(JSON.stringify({ chain: value })), context);
      const sdkValue = await acceptProtocolInput({ kind: 'value', value }, context);
      assert.deepEqual(consumerReport, sdkValue, name);
      await writeFile(join(dir,'chain.json'), JSON.stringify(value)); await writeFile(join(dir,'context.json'), JSON.stringify(context));
      let stdout, status = 0;
      try { stdout = execFileSync(process.execPath, [...process.execArgv.filter(x => x === '--experimental-global-webcrypto'), new URL('../../../packages/cli/bin/proofmeta.mjs', import.meta.url).pathname, 'accept', join(dir,'chain.json'), '--operation', 'license-chain', '--purpose', 'consumer-response', '--context', join(dir,'context.json'), '--json'], { encoding: 'utf8', timeout: 6000, maxBuffer: 1024*1024 }); }
      catch (error) { status = error.status; stdout = error.stdout; }
      assert.equal(status, accepted ? 0 : 1, name); assert.deepEqual(JSON.parse(stdout), JSON.parse(JSON.stringify(sdk)), name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('foreign internally valid POST with same request ID is rejected before GET', async () => {
  const r = await scenario('foreign-post');
  assert.equal((await acceptProtocolInput({ kind: 'value', value: r.chain }, { operation: 'license-chain', purpose: 'protocol-conformance' })).accepted, true);
  assert.equal(r.code, 1, r.output); assert.equal(r.gets, 0);
});
