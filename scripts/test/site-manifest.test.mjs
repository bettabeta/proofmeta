// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest } from '../sign-site-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'site/.well-known/proofmeta.json'), 'utf8'));

test('committed site manifest hashes match the files it describes', async () => {
  assert.deepEqual(await checkManifest(manifest), []);
});

test('stale content_hash is reported', async () => {
  const stale = structuredClone(manifest);
  stale.payload.items.find((i) => i.item_id === 'browser-tools-bundle').content_hash = `sha256:${'0'.repeat(64)}`;
  const problems = await checkManifest(stale);
  assert.ok(problems.some((p) => p.startsWith('manifest not accepted')));
  assert.ok(problems.some((p) => p.startsWith('item browser-tools-bundle: content_hash')));
});

test('stale terms_hash is reported', async () => {
  const stale = structuredClone(manifest);
  stale.payload.license_types[0].terms_hash = `sha256:${'0'.repeat(64)}`;
  assert.ok((await checkManifest(stale)).some((p) => p.startsWith('license apache-2.0: terms_hash')));
});

test('unknown or missing items are rejected', async () => {
  const extra = structuredClone(manifest);
  extra.payload.items.push({ ...extra.payload.items[0], item_id: 'unlisted' });
  assert.ok((await checkManifest(extra)).some((p) => p.startsWith('items:')));
  const missing = structuredClone(manifest);
  missing.payload.items.pop();
  assert.ok((await checkManifest(missing)).some((p) => p.startsWith('items:')));
});

test('stale description is reported', async () => {
  const stale = structuredClone(manifest);
  stale.payload.items[0].description = 'PROOFMETA_ANWEISUNG.md — old';
  assert.ok((await checkManifest(stale)).some((p) => p.endsWith('stale description')));
});
