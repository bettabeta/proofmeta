// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
// Build-only dependencies; generated runtime is self-contained browser ESM.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'packages/sdk-ts/package.json'));
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;
const standalone = require('ajv/dist/standalone').default;
const esbuild = require('esbuild');
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true, esm: true }, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv, { mode: 'full' });
const names = { envelope: 'envelope.schema.json', manifest: 'payload.manifest.schema.json', licenseRequest: 'payload.license-request.schema.json', statusUpdate: 'payload.status-update.schema.json' };
const exports = {}, schemas = {};
for (const [name, file] of Object.entries(names)) {
  const bytes = await readFile(join(root, 'packages/spec', file));
  const schema = JSON.parse(bytes);
  ajv.addSchema(schema); exports[name] = schema.$id;
  schemas[file] = createHash('sha256').update(bytes).digest('hex');
}
const built = await esbuild.build({ absWorkingDir: root, stdin: { contents: standalone(ajv, exports), resolveDir: dirname(require.resolve('ajv/package.json')), sourcefile: 'standalone.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, legalComments: 'inline', metafile: true });
const code = built.outputFiles[0].text;
// No unbundled Node/import helper and no runtime code generation.
const ts = require('typescript');
const ast = ts.createSourceFile('validators.js', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
function audit(node) {
  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression) && ['require','eval','Function'].includes(node.expression.text)) throw new Error('Runtime code generation or require');
  ts.forEachChild(node, audit);
}
audit(ast);
if (code.includes('node:') || Object.values(built.metafile.outputs).some(o => o.imports.length)) throw new Error('Non-browser standalone output');
const out = join(root, 'packages/sdk-ts/dist');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'acceptance-validators.js'), code);
await writeFile(join(out, 'acceptance-validators.d.ts'), 'export interface ValidationError { instancePath: string; keyword: string; }\nexport interface Validator { (value: unknown): boolean; errors?: ValidationError[] | null; }\n' + Object.keys(names).map(n => `export declare const ${n}: Validator;`).join('\n') + '\n');
await writeFile(join(out, 'acceptance-validator-provenance.json'), JSON.stringify({ schemas, pins: Object.fromEntries(['ajv','ajv-formats','esbuild','typescript','fast-uri'].map(n => [n,require(n+'/package.json').version])), bytes: Buffer.byteLength(code), sha256: createHash('sha256').update(code).digest('hex'), imports: Object.values(built.metafile.outputs).flatMap(o => o.imports) }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'generated', bytes: Buffer.byteLength(code), schemas }));
