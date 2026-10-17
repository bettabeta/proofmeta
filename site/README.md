# proofmeta.com — site

Static homepage for the ProofMeta Protocol. Deployed on Vercel from this subfolder.

## Vercel setup

- **Root Directory:** `site`
- **Framework Preset:** Other
- **Build Command:** *(leave empty)*
- **Output Directory:** *(leave empty — serve files as-is)*
- **Install Command:** *(leave empty)*

## Files

- `index.html` — homepage (single-file, no build step)
- `generate/index.html` — Manifest Generator (client-side only; keys never leave the browser)
- `verify/index.html` — Envelope Verifier (client-side only, fail-closed acceptance checks)
- `tools/proofmeta-tools.min.js` — generated SDK browser bundle used by both tools.
  Rebuild with `npm run build && node scripts/build-site-tools.mjs` from the repo root;
  never edit by hand.
- `vercel.json` — redirects + security headers
- `scanner/` — *(to be added)* legacy ProofMeta Scanner, moved here from root

## Redirects

Scanner URLs that used to live at the root (e.g. `/report`, `/thanks`) should be added
to `vercel.json` under `redirects` with `"permanent": true` once the Scanner files are
moved into `scanner/`.

## Local preview

Any static file server works. For example:

```
npx serve .
```

## Not deployed by Vercel

Everything outside `site/` in the repo root (spec, SDK, packages, examples, docs) is
intentionally excluded from the deployment by the Root Directory setting.
