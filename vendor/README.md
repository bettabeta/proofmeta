# vendor/

`proofmeta-sdk-ts-0.5.0.tgz` is the unmodified `npm pack` output of `packages/sdk-ts` from
[bettabeta/proofmeta](https://github.com/bettabeta/proofmeta) at commit
`4f56c813abdd4ee6b2b573d584245e523b164301`.

- sha256: `22508da9664dc98055210825cf6a5c3d458b06a5cc636054c392ebd7d7660835`
- Reproduce: in that checkout, `npm ci --ignore-scripts && npm run build && cd packages/sdk-ts && npm pack`

It exists only because `@proofmeta/sdk-ts@0.5.0` is not yet on npm; the latest published version (0.2.0)
implements the legacy payload-hash-only signature rule that D16 requires verifiers to reject.
Once 0.5.0 is published, replace the `file:` dependency with `"@proofmeta/sdk-ts": "0.5.0"`, refresh the
lockfile, and delete this directory.
