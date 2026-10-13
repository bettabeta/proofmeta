// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as generated from '../dist/acceptance-validators.js';
import { validatorFixtures } from './acceptance-fixtures.mjs';
const require = createRequire(import.meta.url), Ajv = require('ajv').default, addFormats = require('ajv-formats').default;
// Same schema and full-format settings as the existing CLI schema validator.
const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv, { mode: 'full' });
const files = { envelope: 'envelope.schema.json', manifest: 'payload.manifest.schema.json', licenseRequest: 'payload.license-request.schema.json', statusUpdate: 'payload.status-update.schema.json' };
const live = {}, hashes = {};
for (const [name,file] of Object.entries(files)) {
  const bytes = readFileSync(new URL(`../../spec/${file}`, import.meta.url));
  hashes[file] = createHash('sha256').update(bytes).digest('hex'); live[name] = ajv.compile(JSON.parse(bytes));
}
const rows = [];
for (const fixture of validatorFixtures) test(`validator parity ${fixture.name}`, () => {
  const actualData = structuredClone(fixture.value), referenceData = structuredClone(fixture.value);
  const actual = generated[fixture.schema](actualData), expected = live[fixture.schema](referenceData);
  assert.equal(actual, expected);
  if (fixture.expected !== undefined) assert.equal(actual, fixture.expected);
  assert.deepEqual(generated[fixture.schema].errors, live[fixture.schema].errors);
  assert.deepEqual(actualData, fixture.value);
  rows.push({ name: fixture.name, schema: fixture.schema, accepted: actual, errors: generated[fixture.schema].errors });
});
test('generator schema provenance has not drifted', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../dist/acceptance-validator-provenance.json', import.meta.url))).schemas, hashes);
  if (process.env.H1A_PARITY_RECORD) writeFileSync(process.env.H1A_PARITY_RECORD, JSON.stringify({ count: rows.length, hashes, rows }, null, 2)+'\n');
});
