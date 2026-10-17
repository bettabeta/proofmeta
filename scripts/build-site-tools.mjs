// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Bundles the SDK into a single browser IIFE for the static site tools.
 * The output is committed because the site deploys from Vercel with no
 * build step (see site/README.md).
 *
 * Usage: npm run build && node scripts/build-site-tools.mjs
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = await build({
  entryPoints: [path.join(root, "scripts/site-tools-entry.mjs")],
  outfile: path.join(root, "site/tools/proofmeta-tools.min.js"),
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "ProofMeta",
  platform: "browser",
  target: ["es2022"],
  banner: {
    js: [
      "// GENERATED FILE — do not edit.",
      "// Rebuild: npm run build && node scripts/build-site-tools.mjs",
      "// Contents: @proofmeta/sdk-ts + @noble/* — Apache-2.0 / MIT, see repo THIRD-PARTY-NOTICES.",
    ].join("\n"),
  },
  metafile: true,
});

const out = Object.entries(result.metafile.outputs)[0];
console.log(JSON.stringify({ status: "generated", file: out[0], bytes: out[1].bytes }));
