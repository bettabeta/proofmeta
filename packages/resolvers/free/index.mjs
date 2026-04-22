// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * @proofmeta/resolver-free — no-op payment resolver.
 *
 * Declares itself as { role: "payment", id: "none" } (or a custom id the
 * Provider chooses). Its `process` hook returns immediately with ok:true,
 * carrying no external side effects. Used for Tier-1 flows and integration
 * tests per Success Criterion #3.
 *
 * The programming interface below is NOT part of the protocol — it's the
 * shape the reference Provider example expects a resolver module to expose.
 * Other Providers are free to invent their own calling convention.
 */

/**
 * @typedef {Object} ResolverDescriptor
 * @property {"payment"|"delivery"|"anchor"|string} role
 * @property {string} id
 *
 * @typedef {Object} ProcessResultOK
 * @property {true} ok
 * @property {Record<string, unknown>} [receipt]
 *
 * @typedef {Object} ProcessResultErr
 * @property {false} ok
 * @property {string} reason
 *
 * @typedef {ProcessResultOK|ProcessResultErr} ProcessResult
 *
 * @typedef {Object} ProcessContext
 * @property {Object} request  The verified OPEN license.request payload
 * @property {Object} licenseType  The Manifest license_types[] entry for this request
 */

/**
 * Create a free resolver instance.
 *
 * @param {Object} [opts]
 * @param {string} [opts.id="none"] — id as it will appear in Manifest.resolvers[].id
 * @returns {{ descriptor: ResolverDescriptor, process: (ctx: ProcessContext) => Promise<ProcessResult> }}
 */
export function createFreeResolver(opts = {}) {
  const id = opts.id ?? "none";
  return {
    descriptor: { role: "payment", id },
    async process(_ctx) {
      // No payment, no external call, no anchor. The license is free.
      return { ok: true, receipt: { resolver: `free:${id}`, confirmed_at: new Date().toISOString() } };
    },
  };
}
