# Changelog

This file records repository history. [`SPEC.md`](./SPEC.md) is the protocol. Text in this file is not a protocol rule.

## Unreleased

### Specification cleanup (2026-10-20)

`SPEC.md` no longer contains the development-tooling section (Claude Projects, Cursor, OpenClaw, Claude Code, or the scaffold that named `/packages/sdk-py` and `solana-anchor`). Later sections are renumbered: v1 scope is §7, success criteria §8, open questions §9, license §10. Review is not a protocol artifact; the specification does not define one, and the places that listed one no longer do. Schema `$id` values use `https://proofmeta.com/schemas/v1/`.

### Removed from SPEC.md (2026-10-20)

Three paragraphs drafted on 2026-10-03 as the approved B1 clarification were removed from `SPEC.md`. Independent review of that draft is still pending. They are copied below so the wording is not lost. Removing them does not change the reference SDK or CLI: those packages already enforce the UTC suffix, the transport BOM rejection, and the Manifest scope URL checks. That implementation is now stricter than `SPEC.md`. Restoring the rules as ordinary normative text, or reverting the checks, needs the pending review.

#### Envelope UTC timestamp

The envelope `timestamp` MUST satisfy the existing schema `date-time` validation and use `Z`, `z`, or `+00:00` as its UTC suffix. `-00:00` (unknown offset) and nonzero offsets MUST be rejected. Fractional seconds are permitted; neither uppercase `Z` only nor a fixed millisecond precision is required. Other date-time syntax and leap-second handling remain governed by the existing date-time validation, not a new `Date.parse` interpretation. Preserve the signed string; do not normalize it before hashing or signature verification. This suffix rule applies only to the envelope `timestamp`, not automatically to `valid_until` or other timestamp fields. It asserts no trusted time, TTL, or time monotonicity.

#### Transport BOM

ProofMeta raw JSON ingress for network messages and CLI protocol files MUST reject a leading UTF-8 BOM (`EF BB BF`) before decoding can hide it. Report an unsupported transport input, not a signature failure. This selects rejection rather than the parser permission to ignore a BOM in RFC 8259; it does not redefine that RFC. U+FEFF inside a JSON string remains valid string data. No BOM stripping or automatic transcoding is permitted. This transport rule does not change JCS output, the signing projection, or JSON Schema; an already parsed value cannot establish whether its original transport had a BOM.

#### Manifest scope URL extensions

For `license_types[].scope`, an entry outside the eight existing core tags MUST parse as an absolute URL under the WHATWG URL parser with no base URL. Reject leading or trailing whitespace and control characters anywhere in the input rather than accepting parser trimming or control-character removal. Keep the original string; do not require equality with a reserialized URL or normalize before signing. There is no HTTPS-only rule, universal host requirement, fetch, or reachability check; syntactically valid absolute `http:`, `https:`, `urn:`, `mailto:`, and other schemes are not rejected merely for their scheme. The existing core-tag minimum and the two existing conflict pairs remain unchanged; the B1 validator default follows the existing SHOULD to reject both conflict pairs, without changing SHOULD to MUST.
