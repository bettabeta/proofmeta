// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASABLE, resolveReleaseTag } from '../release-tag.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts/release-tag.mjs');

function fixture(manifests) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-tag-'));
  for (const [dir, manifest] of Object.entries(manifests)) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

function withFixture(manifests, fn) {
  const root = fixture(manifests);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('every releasable workspace resolves from its own current version', () => {
  for (const [short, dir] of Object.entries(RELEASABLE)) {
    const { version } = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
    const release = resolveReleaseTag(`${short}@${version}`, repoRoot);
    assert.equal(release.name, `@proofmeta/${short}`);
    assert.equal(release.dir, dir);
    assert.equal(release.version, version);
  }
});

test('cli lists its @proofmeta dependencies with ranges, nothing else', () => {
  const { version, dependencies } = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/cli/package.json'), 'utf8'),
  );
  const release = resolveReleaseTag(`cli@${version}`, repoRoot);
  assert.deepEqual(release.internalDependencies, [
    `@proofmeta/sdk-ts@${dependencies['@proofmeta/sdk-ts']}`,
    `@proofmeta/spec@${dependencies['@proofmeta/spec']}`,
  ]);
});

test('prerelease versions publish under next, releases under latest', () => {
  const manifests = (version) => ({ 'packages/spec': { name: '@proofmeta/spec', version } });
  withFixture(manifests('1.2.3-rc.1'), (root) => {
    assert.equal(resolveReleaseTag('spec@1.2.3-rc.1', root).distTag, 'next');
  });
  withFixture(manifests('1.2.3'), (root) => {
    assert.equal(resolveReleaseTag('spec@1.2.3', root).distTag, 'latest');
  });
});

test('malformed, unknown or non-semver tags are rejected', () => {
  for (const tag of [
    undefined,
    '',
    'v0.5.0',
    'cli',
    'cli@',
    '@proofmeta/cli@0.5.0',
    'CLI@0.5.0',
    'example-provider@0.4.0',
    'constructor@1.0.0',
    'cli@0.5',
    'cli@v0.5.0',
    'cli@00.5.0',
    'cli@0.5.0+build',
    'cli@0.5.0\nname=evil',
  ]) {
    assert.throws(() => resolveReleaseTag(tag, repoRoot), Error, `accepted ${JSON.stringify(tag)}`);
  }
});

test('version mismatch between tag and manifest is rejected', () => {
  withFixture({ 'packages/cli': { name: '@proofmeta/cli', version: '0.5.0' } }, (root) => {
    assert.throws(() => resolveReleaseTag('cli@0.5.1', root), /does not match tag/);
  });
});

test('manifest name mismatch is rejected', () => {
  withFixture({ 'packages/cli': { name: '@other/cli', version: '0.5.0' } }, (root) => {
    assert.throws(() => resolveReleaseTag('cli@0.5.0', root), /is not @proofmeta\/cli/);
  });
});

test('any "private" field is rejected, even false', () => {
  for (const value of [true, false]) {
    const manifest = { name: '@proofmeta/cli', version: '0.5.0', private: value };
    withFixture({ 'packages/cli': manifest }, (root) => {
      assert.throws(() => resolveReleaseTag('cli@0.5.0', root), /declares "private"/);
    });
  }
});

test('missing or unparsable manifest is rejected', () => {
  withFixture({}, (root) => {
    assert.throws(() => resolveReleaseTag('cli@0.5.0', root), /ENOENT/);
  });
  const root = fixture({});
  try {
    mkdirSync(path.join(root, 'packages/cli'), { recursive: true });
    writeFileSync(path.join(root, 'packages/cli/package.json'), '{');
    assert.throws(() => resolveReleaseTag('cli@0.5.0', root), SyntaxError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI prints GitHub Actions outputs on success', () => {
  const { version } = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/sdk-ts/package.json'), 'utf8'),
  );
  const out = execFileSync(process.execPath, [script, `sdk-ts@${version}`], { encoding: 'utf8' });
  assert.equal(
    out,
    [
      'name=@proofmeta/sdk-ts',
      'dir=packages/sdk-ts',
      `version=${version}`,
      'dist_tag=latest',
      'internal_dependencies=',
      '',
    ].join('\n'),
  );
});

test('CLI exits non-zero with no stdout on rejection', () => {
  for (const args of [[], ['cli@9.9.9']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^release-tag: /);
  }
});
