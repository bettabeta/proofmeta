#!/usr/bin/env node
// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`proofmeta: ${err?.stack || err?.message || String(err)}\n`);
    process.exit(2);
  },
);
