# Security

ProofMeta fails closed. Report a vulnerability the same way: in private, to the maintainer, before any public write-up.

## Report a vulnerability

Email [daud@license.rocks](mailto:daud@license.rocks). The address published on proofmeta.com, [daud@licenserocks.de](mailto:daud@licenserocks.de), reaches the same maintainer.

Say:

- which spec rule, package, and version is affected
- what a verifier, provider, or the install path accepts that it must reject, or the reverse
- a minimal envelope, vector, or command that shows the defect
- whether the defect is already public

There is no bug bounty. Do not open a public GitHub issue for an unfixed security defect.

## In scope

- signature, hash, canonicalization, or `did:key` verification that accepts a non-conforming envelope
- lifecycle or authorization checks that skip a missing or malformed field
- key material leaving the browser generator or verifier
- the install and publish path in `docs/SUPPLY-CHAIN.md` and `.github/workflows/release.yml`

## Out of scope

- a profile repository's own policy
- rejection of malformed input that the specification already requires

The maintainer confirms receipt and coordinates a fix before public discussion. Wait for that before writing about the defect in public.
