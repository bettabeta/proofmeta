// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASABLE } from '../release-tag.mjs';
import { compareSemver, planRelease } from '../release-plan.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../release-plan.mjs');

const BASE = { spec: '0.4.0', 'sdk-ts': '0.6.0', 'resolver-free': '0.3.0', cli: '0.6.0' };

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function writeVersions(root, versions) {
  for (const [short, dir] of Object.entries(RELEASABLE)) {
    mkdirSync(path.join(root, dir), { recursive: true });
    const manifest = { name: `@proofmeta/${short}`, version: versions[short] };
    writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
}

function commit(root, versions, message) {
  writeVersions(root, versions);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function withRepo(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-plan-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'config', 'user.name', 'test');
    git(root, 'config', 'commit.gpgsign', 'false');
    const before = commit(root, BASE, 'base');
    return fn(root, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const main = (root, before, sha) =>
  planRelease({ repoRoot: root, refType: 'branch', refName: 'main', before, sha });

test('semver order follows semver 2.0.0 precedence', () => {
  const ordered = [
    '0.9.9',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
    '10.0.0',
  ];
  for (let i = 0; i < ordered.length; i += 1) {
    assert.equal(compareSemver(ordered[i], ordered[i]), 0);
    for (let j = i + 1; j < ordered.length; j += 1) {
      assert.equal(compareSemver(ordered[i], ordered[j]), -1, `${ordered[i]} < ${ordered[j]}`);
      assert.equal(compareSemver(ordered[j], ordered[i]), 1, `${ordered[j]} > ${ordered[i]}`);
    }
  }
  for (const bad of [undefined, '', '1.0', 'v1.0.0', '01.0.0', '1.0.0+build']) {
    assert.throws(() => compareSemver(bad, '1.0.0'), /is not semver/);
  }
});

test('a push without version changes plans nothing', () => {
  withRepo((root, before) => {
    const sha = commit(root, BASE, 'docs only');
    assert.deepEqual(main(root, before, sha), []);
  });
});

test('raised versions are planned in dependency order', () => {
  withRepo((root, before) => {
    const sha = commit(
      root,
      { spec: '0.4.1', 'sdk-ts': '0.6.0', 'resolver-free': '0.3.0', cli: '0.7.0-rc.1' },
      'bump',
    );
    assert.deepEqual(main(root, before, sha), ['spec@0.4.1', 'cli@0.7.0-rc.1']);
  });
  withRepo((root, before) => {
    const sha = commit(
      root,
      { spec: '0.5.0', 'sdk-ts': '0.7.0', 'resolver-free': '0.4.0', cli: '0.7.0' },
      'bump',
    );
    assert.deepEqual(main(root, before, sha), [
      'spec@0.5.0',
      'sdk-ts@0.7.0',
      'resolver-free@0.4.0',
      'cli@0.7.0',
    ]);
  });
});

test('a lowered or non-semver version fails closed', () => {
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.5.9' }, 'downgrade');
    assert.throws(() => main(root, before, sha), /version 0\.5\.9 is not greater than 0\.6\.0/);
  });
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.6.0-rc.1' }, 'prerelease of current');
    assert.throws(() => main(root, before, sha), /is not greater than/);
  });
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.7' }, 'not semver');
    assert.throws(() => main(root, before, sha), /is not semver/);
  });
});

test('an existing tag on the pushed commit is kept, elsewhere it fails closed', () => {
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.6.1' }, 'bump');
    git(root, 'tag', 'cli@0.6.1', sha);
    assert.deepEqual(main(root, before, sha), ['cli@0.6.1']);
  });
  withRepo((root, before) => {
    git(root, 'tag', 'cli@0.6.1', before);
    const sha = commit(root, { ...BASE, cli: '0.6.1' }, 'bump');
    assert.throws(() => main(root, before, sha), /tag cli@0\.6\.1 already points at/);
  });
});

test('an unusable previous commit fails closed', () => {
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.6.1' }, 'bump');
    for (const bad of [undefined, '', '0'.repeat(40), 'abc', before.slice(0, 12)]) {
      assert.throws(
        () => main(root, bad, sha),
        /is not a usable SHA/,
        `accepted ${JSON.stringify(bad)}`,
      );
    }
    git(root, 'checkout', '-q', '--orphan', 'other');
    const unrelated = commit(root, BASE, 'unrelated');
    git(root, 'checkout', '-q', 'main');
    assert.throws(() => main(root, unrelated, sha), /is not an ancestor/);
    assert.throws(() => main(root, sha, before), /is not an ancestor/);
  });
});

test('a releasable package.json missing on either side fails closed', () => {
  withRepo((root) => {
    rmSync(path.join(root, 'packages/cli'), { recursive: true, force: true });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'drop cli');
    const before = git(root, 'rev-parse', 'HEAD');
    const sha = commit(root, BASE, 'restore cli');
    assert.throws(() => main(root, before, sha), /packages\/cli\/package\.json is missing at/);
  });
});

test('only main pushes and valid tags are planned', () => {
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, cli: '0.6.1' }, 'bump');
    assert.deepEqual(planRelease({ repoRoot: root, refType: 'tag', refName: 'cli@0.6.1', sha }), [
      'cli@0.6.1',
    ]);
    assert.throws(
      () => planRelease({ repoRoot: root, refType: 'tag', refName: 'cli@0.6.2', sha }),
      /does not match tag/,
    );
    assert.throws(
      () => planRelease({ repoRoot: root, refType: 'branch', refName: 'feature', before, sha }),
      /refusing to plan/,
    );
    assert.throws(
      () => planRelease({ repoRoot: root, refType: undefined, refName: 'main', before, sha }),
      /refusing/,
    );
    assert.throws(() => main(root, before, 'HEAD'), /is not a full SHA/);
  });
});

test('CLI writes one GitHub Actions output line, or fails with no stdout', () => {
  withRepo((root, before) => {
    const sha = commit(root, { ...BASE, 'sdk-ts': '0.6.1', cli: '0.6.1' }, 'bump');
    mkdirSync(path.join(root, 'scripts'));
    for (const file of ['release-plan.mjs', 'release-tag.mjs']) {
      copyFileSync(path.join(path.dirname(script), file), path.join(root, 'scripts', file));
    }
    const run = (env) =>
      spawnSync(process.execPath, [path.join(root, 'scripts/release-plan.mjs')], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...env },
      });
    const ok = run({ REF_TYPE: 'branch', REF_NAME: 'main', BEFORE: before, SHA: sha });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'tags=sdk-ts@0.6.1 cli@0.6.1\n');
    const none = run({ REF_TYPE: 'branch', REF_NAME: 'main', BEFORE: sha, SHA: sha });
    assert.equal(none.stdout, 'tags=\n');
    const bad = run({ REF_TYPE: 'branch', REF_NAME: 'main', BEFORE: '0'.repeat(40), SHA: sha });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /^release-plan: /);
  });
});
