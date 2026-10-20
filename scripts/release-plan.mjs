// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
// Decides which release tags a `release.yml` run publishes, in dependency order.
// A tag push releases exactly that tag. A push to main releases every releasable
// workspace whose `version` changed between the pushed range's endpoints.
// Anything ambiguous fails closed.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASABLE, resolveReleaseTag } from './release-tag.mjs';

const SHA = /^[0-9a-f]{40}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(version) {
  const match = typeof version === 'string' ? SEMVER.exec(version) : null;
  if (!match) throw new Error(`version ${JSON.stringify(version)} is not semver`);
  return {
    core: match.slice(1, 4).map(BigInt),
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function compareIdentifiers(a, b) {
  const numA = /^\d+$/.test(a);
  const numB = /^\d+$/.test(b);
  if (numA && numB) return BigInt(a) === BigInt(b) ? 0 : BigInt(a) < BigInt(b) ? -1 : 1;
  if (numA !== numB) return numA ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i += 1) {
    const order = compareIdentifiers(left.pre[i], right.pre[i]);
    if (order !== 0) return order;
  }
  return Math.sign(left.pre.length - right.pre.length);
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function versionAt(repoRoot, commit, dir) {
  let text;
  try {
    text = git(repoRoot, ['show', `${commit}:${dir}/package.json`]);
  } catch {
    throw new Error(`${dir}/package.json is missing at ${commit}`);
  }
  return JSON.parse(text).version;
}

function tagTarget(repoRoot, tag) {
  try {
    return git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]).trim();
  } catch {
    return null;
  }
}

export function planRelease({ repoRoot, refType, refName, before, sha }) {
  if (!SHA.test(sha ?? '')) throw new Error(`commit ${JSON.stringify(sha)} is not a full SHA`);
  if (refType === 'tag') {
    resolveReleaseTag(refName, repoRoot);
    return [refName];
  }
  if (refType !== 'branch' || refName !== 'main') {
    throw new Error(`refusing to plan a release for ${refType} ${JSON.stringify(refName)}`);
  }
  if (!SHA.test(before ?? '') || /^0+$/.test(before)) {
    throw new Error(`previous commit ${JSON.stringify(before)} is not a usable SHA`);
  }
  try {
    git(repoRoot, ['merge-base', '--is-ancestor', before, sha]);
  } catch {
    throw new Error(`previous commit ${before} is not an ancestor of ${sha}`);
  }
  const tags = [];
  for (const [short, dir] of Object.entries(RELEASABLE)) {
    const previous = versionAt(repoRoot, before, dir);
    const current = versionAt(repoRoot, sha, dir);
    if (previous === current) continue;
    if (compareSemver(current, previous) <= 0) {
      throw new Error(`${dir} version ${current} is not greater than ${previous}`);
    }
    const tag = `${short}@${current}`;
    resolveReleaseTag(tag, repoRoot);
    const target = tagTarget(repoRoot, tag);
    if (target !== null && target !== sha) {
      throw new Error(`tag ${tag} already points at ${target}, not ${sha}`);
    }
    tags.push(tag);
  }
  return tags;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const tags = planRelease({
      repoRoot,
      refType: process.env.REF_TYPE,
      refName: process.env.REF_NAME,
      before: process.env.BEFORE,
      sha: process.env.SHA,
    });
    process.stdout.write(`tags=${tags.join(' ')}\n`);
  } catch (error) {
    process.stderr.write(`release-plan: ${error.message}\n`);
    process.exit(1);
  }
}
