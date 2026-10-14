// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
const core = new Set(['commercial', 'non-commercial', 'derivative-allowed', 'attribution-required', 'ai-training-allowed', 'ai-training-excluded', 'sublicense-allowed', 'revocable']);
/** Manifest scope only. No URL reserialization, fetching or use authorization. */
export function validateManifestScope(scope: unknown): { ok: boolean; index?: number } {
  if (!Array.isArray(scope) || scope.length === 0) return { ok: false };
  let hasCore = false;
  const seen = new Set<string>();
  for (let index = 0; index < scope.length; index++) {
    const tag: unknown = scope[index];
    if (typeof tag !== 'string') return { ok: false, index };
    if (core.has(tag)) {
      hasCore = true;
      // Implement the existing validator SHOULD for exactly these two pairs.
      const opposite = tag === 'commercial' ? 'non-commercial' : tag === 'non-commercial' ? 'commercial'
        : tag === 'ai-training-allowed' ? 'ai-training-excluded' : tag === 'ai-training-excluded' ? 'ai-training-allowed' : undefined;
      if (opposite !== undefined && seen.has(opposite)) return { ok: false, index };
      seen.add(tag);
    } else {
      if (tag.trim() !== tag || /[\u0000-\u001f\u007f-\u009f]/u.test(tag)) return { ok: false, index };
      try { new URL(tag); } catch { return { ok: false, index }; }
    }
  }
  return { ok: hasCore };
}
