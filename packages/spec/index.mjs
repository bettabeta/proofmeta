// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * @proofmeta/spec — exposes ProofMeta's JSON Schemas as ESM values so
 * consumers (validators, SDKs, test tooling) don't have to do path gymnastics.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(here, name), "utf-8"));

export const envelopeSchema = load("envelope.schema.json");
export const manifestPayloadSchema = load("payload.manifest.schema.json");
export const licenseRequestPayloadSchema = load(
  "payload.license-request.schema.json",
);
export const statusUpdatePayloadSchema = load(
  "payload.status-update.schema.json",
);

/** payload.type → payload schema. */
export const payloadSchemas = {
  manifest: manifestPayloadSchema,
  "license.request": licenseRequestPayloadSchema,
  "status.update": statusUpdatePayloadSchema,
};
