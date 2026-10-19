// Trusted, bounded Z1 graph gate and separate post-install smoke; not a sandbox.
import assert from 'node:assert/strict';
import { readFileSync, lstatSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.slice(2);
assert.ok(mode.length === 0 || (mode.length === 1 && mode[0] === '--preinstall'), 'Use --preinstall or no arguments');
if (mode[0] === '--preinstall') {
  // Byte pins deliberately reject *all* graph/manifest changes, including formatting.
  // Updating these requires a separate graph/hook audit, not lock regeneration here.
  const approved = {
    'package.json': '57fa9e574776d0d93e707fdd14d7240c25a120bf87b6f8091405f97373659187',
    'package-lock.json': 'd9ecf349d227e904e22c373d09a037aabfb5f77190ad61b19877b9c36542e1c2',
    'examples/consumer/package.json': 'c0a08243ece4f4194a324643431b4e08d482fbe5bd61812cddf9dd77b7cf9adb',
    'examples/provider/package.json': 'd370785dcac1b369eabc549fe4e23be555e6a9e35840cc47108ee9453c970779',
    'packages/cli/package.json': '6430872e7f16340c4d1924d35bdcafc572061e565090acbb550f42028a5f0e16',
    'packages/resolvers/free/package.json': '801dc7525679a3d965e4cb020e13895517a991464c5148e1391e53bd15c93119',
    'packages/sdk-ts/package.json': '286e7b3471714d81e19340bc09315912a7d15442011b2cba63a9f716b946e4ba',
    'packages/spec/package.json': 'f5a4c8dcf9ff97fd30dade432734b22665816fa080f4cf255dd638f59fde88c8'
  };
  assert.equal(resolve(process.cwd()), root, 'Run from the checkout root');
  assert.equal(process.env.ESBUILD_BINARY_PATH, undefined, 'No alternate binary permitted');
  assert.equal(existsSync(join(root, 'node_modules')), false, 'PRE requires a clean checkout without node_modules');
  const raw = {};
  for (const [path, hash] of Object.entries(approved)) {
    let current = root;
    for (const component of path.split('/')) {
      current = join(current, component);
      assert.equal(lstatSync(current).isSymbolicLink(), false, `No symlink: ${path}`);
    }
    assert.ok(lstatSync(current).isFile(), `Not a regular file: ${path}`);
    const bytes = readFileSync(current);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `Unapproved raw graph/manifest: ${path}`);
    raw[path] = JSON.parse(bytes.toString('utf8'));
  }
  const workspaces = Object.keys(approved).filter(p => p.endsWith('/package.json')).map(p => dirname(p));
  for (const [parent, names] of [['examples', ['consumer', 'provider']], ['packages/resolvers', ['README.md', 'free']]]) {
    assert.deepEqual(readdirSync(join(root, parent)).sort(), names, `Unapproved wildcard workspace: ${parent}`);
    if (parent === 'packages/resolvers') assert.ok(lstatSync(join(root, parent, 'README.md')).isFile(), 'Resolver README must remain a regular non-workspace file');
  }
  const installHooks = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'];
  for (const path of ['', ...workspaces]) {
    for (const file of ['.npmrc', 'npm-shrinkwrap.json', 'binding.gyp', 'node_modules']) {
      assert.equal(existsSync(join(root, path, file)), false, `Unsupported install input: ${path}/${file}`);
    }
    const manifest = raw[path ? `${path}/package.json` : 'package.json'];
    for (const hook of installHooks) assert.equal(Object.hasOwn(manifest.scripts || {}, hook), false, `Unsupported hook: ${path}:${hook}`);
  }
  const graph = raw['package-lock.json'];
  assert.equal(graph.lockfileVersion, 3);
  const local = Object.keys(graph.packages).filter(p => p && !p.startsWith('node_modules/')).sort();
  assert.deepEqual(local, [...workspaces].sort(), 'Only approved local workspaces');
  let registryPackages = 0;
  let workspaceLinks = 0;
  for (const [path, entry] of Object.entries(graph.packages)) {
    if (!path.startsWith('node_modules/')) continue;
    if (entry.link === true) {
      assert.ok(workspaces.includes(entry.resolved), `Unsupported directory/link: ${path}`);
      workspaceLinks++;
    } else {
      assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\/.+\.tgz$/, `Only pinned registry tarballs: ${path}`);
      assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `Missing SRI: ${path}`);
      assert.match(entry.version, /^\d+\.\d+\.\d+$/, `Unpinned version: ${path}`);
      registryPackages++;
    }
  }
  assert.equal(workspaceLinks, 6);
  assert.equal(registryPackages, 39);
  console.log(JSON.stringify({ status: 'preInstallGraphPass', node: process.version, registryPackages, workspaceLinks, npmLaunched: false, scope: 'Exact audited Z1 bytes only; no checkout/TOCTOU sandbox' }));
} else {
const require = createRequire(new URL('../packages/sdk-ts/package.json', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const [name, version] of Object.entries({ ajv: '8.18.0', 'ajv-formats': '3.0.1', esbuild: '0.28.2', typescript: '5.7.3', 'fast-uri': '3.1.8', '@proofmeta/spec': '0.4.0' })) {
  const manifest = name === '@proofmeta/spec'
    ? new URL('../packages/spec/package.json', import.meta.url)
    : require.resolve(`${name}/package.json`);
  const installed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (name === '@proofmeta/spec') assert.equal(require.resolve(name), new URL('../packages/spec/index.mjs', import.meta.url).pathname);
  assert.equal(installed.version, version, name);
}
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validateDateTime = ajv.compile({ type: 'string', format: 'date-time' });
assert.equal(validateDateTime('2026-01-01T00:00:00Z'), true);
assert.equal(validateDateTime('not-a-date'), false);
const ajvRequire = createRequire(require.resolve('ajv'));
assert.equal(JSON.parse(readFileSync(ajvRequire.resolve('fast-uri/package.json'), 'utf8')).version, '3.1.8');
const fastUri = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/fast-uri'));
assert.ok(fastUri.length > 0);
for (const [path, metadata] of fastUri) assert.equal(metadata.version, '3.1.8', path);
assert.equal(process.platform, 'linux', 'This bounded check covers Linux x64 only, not the P2 runtime/platform matrix');
assert.equal(process.arch, 'x64');
assert.equal(process.env.ESBUILD_BINARY_PATH, undefined, 'No alternate binary permitted');
const binary = require.resolve('@esbuild/linux-x64/bin/esbuild');
assert.equal(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), '0.28.2');
const esbuild = require('esbuild');
assert.equal(esbuild.version, '0.28.2');
const result = esbuild.transformSync('const n: number = 1;', { loader: 'ts', target: 'es2022' });
assert.match(result.code, /const n = 1;/);
console.log(JSON.stringify({ status: 'localInstallPass', node: process.version, platform: process.platform, arch: process.arch, binary, esbuild: esbuild.version, fastUriInstances: fastUri.length, dependencyLifecycleScriptsInvokedBySmoke: false, scope: 'Post-install smoke only; does not prove prior lifecycle suppression, Z1 not P2 or release' }));
}
