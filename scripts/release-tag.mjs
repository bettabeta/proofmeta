// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
// Maps a release tag `<package>@<version>` to exactly one public workspace whose
// manifest declares that name and version. Anything else fails closed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASABLE = Object.freeze({
  spec: 'packages/spec',
  'sdk-ts': 'packages/sdk-ts',
  'resolver-free': 'packages/resolvers/free',
  cli: 'packages/cli',
});

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function resolveReleaseTag(tag, repoRoot) {
  if (typeof tag !== 'string' || tag === '') throw new Error('release tag missing');
  const match = /^([a-z][a-z0-9-]*)@(.+)$/.exec(tag);
  if (!match) throw new Error(`malformed release tag ${JSON.stringify(tag)}`);
  const [, short, version] = match;
  if (!Object.hasOwn(RELEASABLE, short)) {
    throw new Error(`release tag names unknown package ${JSON.stringify(short)}`);
  }
  if (!SEMVER.test(version)) {
    throw new Error(`release tag version ${JSON.stringify(version)} is not semver`);
  }
  const dir = RELEASABLE[short];
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
  const name = `@proofmeta/${short}`;
  if (pkg.name !== name) {
    throw new Error(`${dir}/package.json name ${JSON.stringify(pkg.name)} is not ${name}`);
  }
  if ('private' in pkg) throw new Error(`${dir}/package.json declares "private"`);
  if (pkg.version !== version) {
    throw new Error(`${dir}/package.json version ${pkg.version} does not match tag ${version}`);
  }
  const internalDependencies = Object.entries(pkg.dependencies ?? {})
    .filter(([dep]) => dep.startsWith('@proofmeta/'))
    .map(([dep, range]) => `${dep}@${range}`);
  return {
    name,
    dir,
    version,
    distTag: version.includes('-') ? 'next' : 'latest',
    internalDependencies,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const release = resolveReleaseTag(process.argv[2], repoRoot);
    process.stdout.write(
      [
        `name=${release.name}`,
        `dir=${release.dir}`,
        `version=${release.version}`,
        `dist_tag=${release.distTag}`,
        `internal_dependencies=${release.internalDependencies.join(' ')}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    process.stderr.write(`release-tag: ${error.message}\n`);
    process.exit(1);
  }
}
