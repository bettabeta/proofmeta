# ProofMeta — Cursor development handoff

This is an unreleased local development candidate, not a merge or release approval.

## Candidate identity

- Git basis: `7076fdd86c4a5b44630b97e266c43c8e9aab9e81`.
- Exact source inventory: 111 files; 50 paths added or modified relative to that basis.
- Ordered provenance: 18 original inputs, Anchor/Renewal v2, HIGH04 H04-06/07 addendum, HIGH04 H04-10/11 close-delivery addendum: 21 patches in total.
- Original frozen candidate source inventory SHA-256: `1b62042b8c02c08d5b079c64f14dbb918bac4c9cf7a8570206a510ad82f17837`.
- Inventory hash format: SHA-256 over sorted UTF-8 lines `path\tdecimal-size\tsha256\n`; modes excluded.
- Final supervisor test SHA-256: `cb4c3bdfc0713e402ed1bf41d13a220da1971dcb2766def5114e6fd9a42b794e`.
- E2E runtime SHA-256: `da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84`.

The original preparation and latest execution copy match all 111 source bytes. A fresh source-only archive of the explicit basis consumed all 21 hash-verified patches and matched the complete candidate inventory. These are mechanical checks, not new runtime QA.

## Publication format delta

The original candidate pin above is retained, not redefined. Publication changes only `packages/sdk-ts/THIRD-PARTY-NOTICES.md`: CRLF to LF and trailing ASCII spaces/tabs removed in original lines 375–625, plus one empty Markdown EOF line removed outside the license blocks. All 14 complete license/notice code blocks compare equal under newline/trailing-ASCII-whitespace normalization.

- Original notice SHA-256: `343425a280ccabb3988e45e05f18d4e288c14a9f0cf92511e77e6ac8c190625f`.
- Publication notice SHA-256: `5455b91d1729b27b63a9560a82d75fa054f7630b69ac719b15faf7894c94449a`.
- Publication source inventory SHA-256 (111 files): `59cc4b71a47b9beca8828f8166839f118c88068698ae0666508eb0d7142f3ef6`.
- This format correction is not runtime acceptance or release approval.

## Working in Cursor

Open the repository root on the approved development branch. Read `.cursorrules`, `AGENTS.md`, and `PROOFMETA_ANWEISUNG.md` before changing anything. The master remains authoritative; schema or protocol changes require explicit authorization. Core stays generic; `policy.scope` remains unresolved and outside B1.

The candidate contains SDK/CLI acceptance and JSON/JCS hardening, provider/consumer integration, owned E2E readiness/cleanup, packaging/legal distribution changes, and cumulative regression fixtures. Preserve its pinned versions and lockfile: this handoff adds no new version bump or dependency change.

## Acceptance boundaries

Earlier scoped independent QA remains valid only within its recorded inputs and criteria. No report establishes complete independent acceptance of this latest combined source tree.

- HIGH04 remains OPEN.
- H04-05: BLOCKED_REACHABILITY / NOTRUN. No genuine live post-deadline header/result delivery proof.
- H04-10/11: CLOSED_SCOPED_UNDER_OWNER_ADDENDUM. The final authorized selective run recorded 2 tests / 2 PASS / 0 FAIL; authentic callback-delay/drop negatives are not proof of missing/late native OS close or SIGKILL survival.
- No newest combined full-suite, Witness, packaging, or unrestricted runtime-support claim.
- Node18 HIGH373 and the historical artifact-security gate remain blocked. Do not retry through another executor or reinterpret old runtime evidence as clearance.
- No PR, merge, release, npm publication, deployment, or broad test execution is authorized by this handoff.

## Experimental QA work

External and modular harness designs are separate experimental sources, not product dependencies or approved executable QA. Infrastructure and module2A/2B source files exist; static artifacts are not dynamic PASS. The integrated source review, execution authorization, complete case coverage, and runtime evidence remain open. Keep these sources under an explicitly labeled experimental archive; do not wire them into npm lifecycle scripts or product imports.

Historical local roots, dependency/dist reuse, raw logs and original freezes stay outside Git. Portability of archived external harnesses is not established: original absolute paths are provenance, not a safe runnable setup.

## Publication hygiene

Stage only the exact source manifest and explicitly reviewed handoff/experimental paths. Never use a blanket staging command. Exclude credentials, profiles, chats, caches, generated distributions, dependency trees, raw evidence and duplicate/obsolete roots. Pattern checks found no recognized credential tokens, private-key PEMs, credential URLs, or literal assigned secrets in the selected files; this is not an exhaustive secret certification. Raw internal reports require separate public-document review.

## Done

Local source-only preservation, literal patch verification, full source parity, differences and bounded publication scanning were performed. No runtime test or installation was performed for this handoff.

## Not done / left open

Branch creation, commits and push require a separate exact owner approval. All acceptance and security boundaries above remain open.

## Observed but out of scope

Local lead HEAD and local main references do not identify this candidate. Do not push them as a substitute for the explicit basis and source manifest.
