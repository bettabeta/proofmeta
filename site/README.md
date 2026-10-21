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
- `.well-known/proofmeta.json` — this site's signed Manifest. After changing any file it
  describes (bundle, `SPEC.md`, `license.txt`), re-sign with
  `PROOFMETA_SITE_SEED=… node scripts/sign-site-manifest.mjs`; hashes are recomputed from
  the files. `node scripts/sign-site-manifest.mjs --check` runs in CI.
- `requests.html` — static `request_endpoint` target declared in the site manifest; explains that no automated endpoint exists yet
- `vercel.json` — security headers, CORS and `Content-Type` for `/.well-known/proofmeta.json`

## Local preview

Any static file server works. For example:

```
npx serve .
```

## Not deployed by Vercel

Everything outside `site/` in the repo root (spec, SDK, packages, examples, docs) is
intentionally excluded from the deployment by the Root Directory setting.
