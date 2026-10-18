// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInThisContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundlePath = path.join(repoRoot, 'site/tools/proofmeta-tools.min.js');

test('committed browser bundle verifyEnvelope fails closed', async () => {
  runInThisContext(readFileSync(bundlePath, 'utf8'));
  const { ProofMeta } = globalThis;
  try {
    const kp = await ProofMeta.generateKeyPair();
    async function signed(timestamp) {
      return ProofMeta.createEnvelope({
        payload: { type: 'manifest', provider: { id: kp.did } },
        author: kp.did,
        privateKey: kp.privateKey,
        timestamp,
      });
    }

    const utc = await ProofMeta.verifyEnvelope(await signed('2026-01-01T00:00:00Z'));
    const offset = await ProofMeta.verifyEnvelope(await signed('2026-01-01T00:00:00+02:00'));
    const good = await signed('2026-01-01T00:00:00.123Z');
    const upperHex = good.signature.slice('ed25519:'.length).toUpperCase();
    const upper = await ProofMeta.verifyEnvelope({ ...good, signature: `ed25519:${upperHex}` });

    let shortThrew = false;
    let short;
    try {
      short = await ProofMeta.verifyEnvelope({ ...good, signature: 'ed25519:abcd' });
    } catch (e) {
      shortThrew = true;
      short = String(e && e.message);
    }

    const missingInput = { ...good };
    delete missingInput.signature;
    let missingThrew = false;
    let missing;
    try {
      missing = await ProofMeta.verifyEnvelope(missingInput);
    } catch (e) {
      missingThrew = true;
      missing = String(e && e.message);
    }

    assert.equal(utc.ok, true);
    assert.equal(offset.ok, false);
    assert.match(offset.reason, /UTC suffix/);
    assert.equal(upper.ok, false);
    assert.match(upper.reason, /ed25519:\[a-f0-9\]\{128\}/);
    assert.equal(shortThrew, false);
    assert.equal(short.ok, false);
    assert.equal(missingThrew, false);
    assert.equal(missing.ok, false);
  } finally {
    globalThis.ProofMeta = undefined;
  }
});
