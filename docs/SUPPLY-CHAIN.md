# Supply chain: why the checkout install is pinned

This is the admission policy for a checkout of this repository. Published npm packages are older than this tree; see the root README.

## Bounded local install policy (Version-P1/Z1)

Use a trusted Node-compatible npm (locally tested Node 18.20.8 / npm 10.8.2), trusted tools/environment/user/global npm configuration, and a fresh checkout without root/workspace `node_modules`. Run from its root. **PRE must succeed before npm is launched**: npm 10.8.2 can execute workspace or `file:`-directory `prepare` even with `--ignore-scripts`. Post-install smoke alone cannot prevent that execution. Keep dependency lifecycle scripts disabled; no global config changes, global script allowance, `npm rebuild`, dependency `install.js`, network binary fallback or arbitrary postinstall execution is authorized:

```sh
node scripts/version-p1-install-smoke.mjs --preinstall &&
  npm ci --ignore-scripts --no-audit &&
  node scripts/version-p1-install-smoke.mjs &&
  npm run build &&
  NODE_OPTIONS=--experimental-global-webcrypto npm test &&
  npm audit
```

PRE uses only Node built-ins and raw JSON reads; it never imports dependencies, evaluates package scripts/config, invokes npm, regenerates the lock, or runs hooks. SHA-256 byte pins cover the audited root manifest, all six workspace manifests and the complete lockfile-v3 graph (39 exact-version/SRI registry tarballs and six approved workspace links). Every manifest/lock change, even formatting or a newly added hook, fails closed until a separate graph/hook audit updates the approved pins. Workspace wildcard entries are exactly consumer/provider/free; extra entries, symlinked manifest paths, root/workspace `.npmrc`, shrinkwrap, `binding.gyp` and pre-existing `node_modules` are rejected. Root/workspace install hooks (`preinstall`, `install`, `postinstall`, `prepublish`, `preprepare`, `prepare`, `postprepare`) are unsupported. The unchanged SDK `prepublishOnly` is publication-only, not enabled or invoked by this sequence. Only the already audited registry tarball graph plus these approved local workspaces is supported: other local directories, local `.tgz`, git, URL, alternate registry, alias or changed hook/graph topologies are rejected. The local `.tgz` malicious-hook fixture is a suppression control for npm, **not** an allowed PRE graph.

This is a bounded admission policy, **not an arbitrary malicious-checkout or TOCTOU sandbox**. The guard itself, tools, environment/config outside the checkout, and checkout contents remaining unchanged between PRE and ci are trust prerequisites. A modified guard or racing writer is not contained. Registry integrity pins are checked by npm during ci, not downloaded/verified by PRE; the audited esbuild registry postinstall remains skipped. PRE success reports graph admission and `npmLaunched: false`, not a completed install; post-smoke reports only that it did not invoke dependency lifecycle scripts, not retrospective proof that none ran. Build/test explicitly execute trusted project commands and are distinct from install suppression. Independent QA of this exact correction remains open.

The scoped smoke is explicitly **Linux x64 only**, not the P2 runtime/platform matrix. It checks the pinned install graph and invokes only the installed optional `@esbuild/linux-x64` executable plus esbuild's transform API to verify version 0.28.2. esbuild's declared `node install.js` postinstall remains skipped; npm installs the platform optional package from the integrity-pinned lock. Do not omit optional dependencies. If the binary is missing, mismatched or an alternate `ESBUILD_BINARY_PATH` is set, fail rather than enabling scripts or downloading a fallback. Other platforms need separately scoped checks/approval. The crypto flag above is command-local, existing Node 18 behavior remains an open support question.

Preserve third-party copyright/license texts with any redistributed dependency, binary or future generated/bundled validator; the SDK [pinned-artifact notices](../packages/sdk-ts/THIRD-PARTY-NOTICES.md) carry those texts. esbuild platform tarballs declare MIT but do not include separate license text; the esbuild parent MIT notice covers them. No browser validator is generated or distributed by this preparation. Local install evidence does not establish P2 external-tarball installation, full runtime matrix, independent QA or release approval.
