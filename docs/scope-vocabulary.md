# Scope Vocabulary

Normative reference for the `license_types[].scope` field of a ProofMeta License Manifest (see §3.3 of [`PROOFMETA_ANWEISUNG.md`](../PROOFMETA_ANWEISUNG.md)).

## Why a vocabulary exists

An agent deciding whether a license fits its intended use needs to filter on tags it can recognize without reading human prose. Free-form strings break that — two Providers can both mean "commercial use allowed" and spell it differently. A closed set of normative tags makes agent-side filtering deterministic.

A closed set is also brittle: it cannot anticipate every jurisdiction, every industry convention, every Provider-specific restriction. So ProofMeta combines a small **normative core** with **URL extensions**. Agents always understand the core; anything they don't understand is addressable by URL and can be handled by policy.

## The core vocabulary (normative)

These tags are the full normative set for v1. A `scope` array MUST contain at least one core tag. Conforming implementations MUST recognize every tag in this list with the meaning given here.

| Tag | Meaning |
|---|---|
| `commercial` | The licensee MAY use the item for commercial purposes, including in paid products, in revenue-generating services, and in work performed for a client. |
| `non-commercial` | The licensee MUST NOT use the item for commercial purposes. Private, educational, and research use is allowed. Mutually exclusive with `commercial`. |
| `derivative-allowed` | The licensee MAY create derivative works (remixes, translations, adaptations, fine-tunes). Absence of this tag means derivative works are not granted by this license. |
| `attribution-required` | The licensee MUST attribute the Provider when using the item. The Manifest's `terms_url` SHOULD describe the attribution format. |
| `ai-training-allowed` | The licensee MAY use the item as training data for machine-learning models. |
| `ai-training-excluded` | The licensee MUST NOT use the item as training data. Mutually exclusive with `ai-training-allowed`. |
| `sublicense-allowed` | The licensee MAY grant a sub-license to a third party under the same or more restrictive terms. Absence of this tag means sub-licensing is not granted. |
| `revocable` | The Provider reserves the right to transition this license to `REVOKED`. Absence of this tag means, once `GRANTED`, the license is intended to be permanent (subject to the terms at `terms_url`). |

### Interpretation rules

1. **Presence is permission.** A tag in the `scope` array means the corresponding action is permitted (or, for `*-required` tags, that a corresponding obligation applies). Absence means the protocol makes no machine-level statement either way — the human-readable `terms_url` is authoritative for anything not explicitly tagged.
2. **Mutually exclusive pairs.** A single `scope` array MUST NOT contain both tags of a mutually-exclusive pair (`commercial` / `non-commercial`, `ai-training-allowed` / `ai-training-excluded`). Validators SHOULD reject manifests that violate this.
3. **AI training is independent of commercial use.** `commercial` says nothing about `ai-training-*`. A Provider that wants to sell commercial licenses but forbid training data use MUST add `ai-training-excluded` explicitly. This is deliberate: the AI-training question is too load-bearing to infer.
4. **The core vocabulary is closed for v1.** New core tags are additive only, introduced via a new spec decision (D-entry in §10). Removals or semantic changes are breaking and reserved for a major version bump.

## URL extensions (non-normative)

Any string in `scope` that is not in the core vocabulary MUST be a URL. This keeps the namespace unambiguous: core tags are short bare identifiers; extensions are URLs. No middle ground.

```json
"scope": [
  "commercial",
  "derivative-allowed",
  "https://beatvault.ai/scope/eu-only",
  "https://creativecommons.org/licenses/by-sa/4.0/"
]
```

**Rules for extension URLs:**

- The URL SHOULD resolve to a human-readable page describing the extension's meaning. This is not machine-enforced, but Providers publishing undocumented scope URLs undermine the ecosystem.
- Consumers that do not understand an extension URL MAY ignore it, MAY reject the license, or MAY surface it to a human — all are valid policies. The protocol does not mandate behavior for unknown extensions.
- Extension URLs are Provider-chosen namespaces. They do not need protocol approval, registration, or coordination.

### When a core tag would fit, use the core tag

A Provider SHOULD NOT reinvent `commercial` as `https://beatvault.ai/scope/commercial`. If the semantics match a core tag, use the core tag — extensions are for semantics the core does not cover (jurisdictional constraints, industry-specific obligations, custom clauses).

## Example combinations

```json
["commercial", "derivative-allowed", "attribution-required", "ai-training-excluded"]
```
A standard commercial license that allows remixing, requires credit, and forbids AI training use.

```json
["non-commercial", "derivative-allowed", "ai-training-allowed"]
```
A license suited to academic or research settings: no commercial use, remixes allowed, training data use permitted.

```json
["commercial", "sublicense-allowed", "revocable", "https://beatvault.ai/scope/eu-only"]
```
A commercial, sub-licensable, revocable license that is additionally constrained to EU territory via a Provider-specific extension.

## Versioning

This document is part of the ProofMeta v1 specification. Changes follow the same lifecycle as the Master Spec's §10 Decided Questions: additive core tags increment the minor version (v1.x), semantic changes require a major version.
