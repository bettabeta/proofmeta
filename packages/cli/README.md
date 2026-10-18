# @proofmeta/cli — 0.5.0 migration

Thin adapter to `@proofmeta/sdk-ts/acceptance`. Package version 0.5.0 implements the v1 draft; it does not declare the ProofMeta protocol v1 released. Wire 1.0, canonical draft-07 schemas and D16 signing projection are unchanged. Ajv/Spec dependency metadata is retained; CLI decisions no longer compile separate validators.

## Local build

From the monorepo root of a fresh clone:

```sh
node scripts/version-p1-install-smoke.mjs --preinstall
npm ci --ignore-scripts --no-audit --no-fund
node scripts/version-p1-install-smoke.mjs
npm run build
node packages/cli/bin/proofmeta.mjs --help
```

PRE/POST admit only the pinned graph. They are not a hostile-checkout/TOCTOU sandbox, nor a generic global-install/npx guarantee; see [docs/SUPPLY-CHAIN.md](../../docs/SUPPLY-CHAIN.md). Node 18 needs `NODE_OPTIONS=--experimental-global-webcrypto` for cryptographic commands.

## `accept`: explicit operation, purpose and evidence

Source and context files are read as bytes: fatal UTF-8, no leading BOM, no duplicate decoded keys, strict JSON domain. No stripping, coercion, URL/time normalization or raw-to-string replacement. Reports are always SDK AcceptanceReport JSON (`--json` is optional).

```sh
node packages/cli/bin/proofmeta.mjs accept manifest.json --operation manifest --purpose protocol-conformance
node packages/cli/bin/proofmeta.mjs accept open.json --operation provider-open --purpose protocol-conformance --context provider-context.json
node packages/cli/bin/proofmeta.mjs accept chain.json --operation license-chain --purpose protocol-conformance
node packages/cli/bin/proofmeta.mjs accept attestation.json --operation attestation-root --purpose protocol-conformance
node packages/cli/bin/proofmeta.mjs accept history.json --operation attestation-chain --purpose protocol-conformance
node packages/cli/bin/proofmeta.mjs accept extension.json --operation inspect-envelope --purpose inspection
node packages/cli/bin/proofmeta.mjs accept response-chain.json --operation license-chain --purpose consumer-response --context consumer-context.json
```

`provider-context.json` is an object containing `expectedProvider` (the expected Provider DID). Consumer evidence is an object with **all** `sentOpen` (the original signed OPEN envelope), `expectedProvider`, `manifest` (the signed Manifest envelope), `item` (`item_id` and `available_licenses`), `licenseType` and `termsHash`. Use the actual sent envelopes and selected item/terms, not placeholders or reconstructed unsigned projections. Source chains are JSON arrays in their signed order. Operation/purpose are CLI arguments, never inferred in accept; matching values may also be present in the context file. Conflicting selectors, non-object contexts, invalid raw JSON or `resolveAuthor` in file configuration are configuration errors. No executable resolver can be supplied through JSON.

Missing required business evidence in an otherwise valid invocation is SDK `CONTEXT_REQUIRED` (exit 1), not a configuration error. Unknown extensions can be inspected with `accepted:false`; core acceptance rejects `PAYLOAD_UNSUPPORTED`. Inspection exits 1 even with no diagnostic error because it is never Accepted.

## `validate`: compatibility diagnostics, not acceptance

```sh
node packages/cli/bin/proofmeta.mjs validate manifest.json
node packages/cli/bin/proofmeta.mjs validate chain.json --json
```

Existing `ok`, `kind`, `envelopes` (index, payload_type, schema/hash/signature) and array `chain`/`transitions` keys remain. SDK `checks`, stable `errors` (code/path/index), `ingress`, `exclusions`, `guarantees`, operation/purpose and the detached checked `snapshot` are added. `accepted` is **always false**, even when diagnostic `ok` is true. Raw source reports retain byte evidence; `validateInput(value)` cannot prove original encoding or duplicate freedom (`not-checked`).

Diagnostic operation routing: Manifest → manifest, Mode-B root → attestation-root, arrays → license-chain or attestation-chain by root; standalone OPEN/status and unknown payloads → inspect-envelope. This inference is only for diagnostics: provider binding or consumer-response acceptance requires explicit `accept` and evidence. Envelope diagnostics use the SDK inspection operation; aggregate errors describe the selected chain/conformance operation, so individually successful crypto/schema checks need not imply overall `ok`.

### Breaking rejection/report changes

- Empty arrays fail `ROOT_INVALID`; malformed input does not throw or pass vacuously.
- Raw invalid encoding/BOM, duplicates, JSON-domain violations and unchanged canonical schemas now gate SDK decisions. Value ingress rejects array extra properties, sparse arrays and other non-JSON values rather than silently stripping them.
- SDK ordering is schema → hash → signature → authority → context/scope. Later checks are `not-checked` after an earlier failure; legacy booleans are false, not an independent extra crypto pass.
- Error strings migrate from Ajv prose/crypto detail to stable SDK code/path. Do not parse legacy prose. Unknown inspection is diagnostic-only, never extension acceptance.
- Manifest scope uses the shared core-tag/absolute-WHATWG-URL/conflict rules; URL-only scope fails. Original signed strings are preserved. `policy.scope` is unresolved/excluded, not a policy pass.

## Exit codes

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| accept | SDK `accepted:true` | protocol/context rejection, including malformed source bytes and inspection | usage, file I/O, malformed/unreadable/conflicting context configuration |
| validate | diagnostic `ok:true`, never Accepted | conformance/ingress rejection | usage/file I/O and legacy `JSON_SYNTAX` exit |

Bool/code parity applies to the same SDK operation, not to adapter I/O exit codes. Reports never attest anchors, trusted time, delivery, payment, legal permission or operational authorization. No clock-based expiry guarantee or network trust is inferred.

## License

Apache-2.0.
