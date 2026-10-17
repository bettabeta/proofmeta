# proofmeta-mcp

A generic [Model Context Protocol](https://modelcontextprotocol.io) server for the
[ProofMeta protocol](https://github.com/bettabeta/proofmeta). It lets an MCP client (Cursor, Claude Desktop,
any agent runtime) discover and verify ProofMeta License Manifests.

- **Protocol only.** No payment, storage, blockchain, registry, or crawling.
- **No own verification logic.** All protocol checks are done by `acceptProtocolInput` from
  `@proofmeta/sdk-ts/acceptance` (operation `manifest`, purpose `protocol-conformance`). This server only
  fetches bytes and hands them over untouched.
- **Fail-closed.** `accepted` is `true` only if transport succeeded _and_ the SDK accepted the manifest. The
  manifest is only returned when it was accepted. Any error, timeout, or exception is a rejection.
- **Generic.** No industry, customer, or use-case knowledge.

> Status: 0.1.0, v1 draft. Acceptance means protocol conformance, not authorization to use anything
> (`report.guarantees.operationalAuthorization` is always `false`). Anchors and trusted time are not checked.

## Tools

| Tool                | Input    | What it does                                                                                              |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `verify_manifest`   | `url`    | One `GET` to an absolute `https:` URL, then SDK acceptance as `manifest`.                                 |
| `discover_manifest` | `domain` | Builds `https://{domain}/.well-known/proofmeta.json` (spec §3.7, D4), then the same as `verify_manifest`. |

Both are read-only (`readOnlyHint: true`) and return:

```jsonc
{
  "accepted": true, // the only field to branch on
  "url": "https://example.com/.well-known/proofmeta.json",
  "domain": "example.com", // discover_manifest only
  "transport": { "ok": true, "status": 200, "contentType": "application/json", "bytes": 1234 },
  "report": {/* SDK AcceptanceReport v1 without `snapshot` */},
  "manifest": {/* the envelope — only when accepted */},
}
```

On rejection the tool result has `isError: true`, the first text line starts with `REJECTED:`, and either
`transport.code` (see below) or `report.errors[].code` (SDK codes such as `HASH_MISMATCH`,
`SIGNATURE_INVALID`, `AUTHORITY_MISMATCH`, `SCHEMA_INVALID`, `BOM_UNSUPPORTED`, `JSON_DUPLICATE_KEY`) explains why.

### Transport rules

These are transport limits of this server, not protocol semantics.

| Code                    | Rule                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `URL_INVALID`           | Not an absolute URL, or contains whitespace/control characters (rejected rather than letting the URL parser trim them).                  |
| `URL_CREDENTIALS`       | `user:pass@` in the URL.                                                                                                                 |
| `SCHEME_UNSUPPORTED`    | Anything other than `https:`. `ipfs:`/`ar:` are valid manifest locations per §3.7 but require a gateway, which this server doesn't have. |
| `DOMAIN_INVALID`        | `discover_manifest` takes a bare FQDN only: no scheme, port, path, IP literal, single label, or trailing dot.                            |
| `REDIRECT_NOT_FOLLOWED` | 3xx responses are not followed; `location` is returned so the caller can decide to `verify_manifest` it explicitly.                      |
| `HTTP_STATUS`           | Anything other than `200`.                                                                                                               |
| `BODY_TOO_LARGE`        | Body larger than `PROOFMETA_MCP_MAX_BYTES` (default 1 MiB).                                                                              |
| `TIMEOUT`               | No complete response within `PROOFMETA_MCP_TIMEOUT_MS` (default 10 s).                                                                   |
| `FETCH_FAILED`          | DNS, TLS, connection errors.                                                                                                             |

`Content-Type` is reported but not enforced; the SDK checks the raw bytes.

## Install and build

Requires Node.js ≥ 20.

```bash
npm ci
npm test        # build + unit/integration tests
npm run smoke   # local end-to-end test over stdio (offline)
```

`@proofmeta/sdk-ts@0.5.0` is not on npm yet, so it is vendored as an unmodified `npm pack` tarball. The latest
published version (0.2.0) uses the legacy signature rule that D16 requires verifiers to reject. See
[`vendor/README.md`](vendor/README.md).

## MCP configuration

Cursor, when working inside this repo: [`.cursor/mcp.json`](.cursor/mcp.json) is already set up (`npm run build` first).

Any other client (Cursor global `~/.cursor/mcp.json`, Claude Desktop `claude_desktop_config.json`, …), see
[`examples/mcp.json`](examples/mcp.json):

```json
{
  "mcpServers": {
    "proofmeta": {
      "command": "node",
      "args": ["/absolute/path/to/proofmeta-mcp/dist/cli.js"]
    }
  }
}
```

### Environment variables

| Variable                            | Default   | Meaning                                                                                                                    |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PROOFMETA_MCP_TIMEOUT_MS`          | `10000`   | Total time for one fetch, including the body.                                                                              |
| `PROOFMETA_MCP_MAX_BYTES`           | `1048576` | Maximum body size.                                                                                                         |
| `PROOFMETA_MCP_ALLOW_HTTP_LOOPBACK` | `0`       | `1` allows plain `http:` to `localhost`, `127.0.0.1`, and `[::1]` only. For local development; never needed in production. |

Invalid values make the server exit with code 2 instead of falling back to defaults.

## Local smoke test

[`examples/smoke/smoke.mjs`](examples/smoke/smoke.mjs) signs a throwaway manifest with the SDK, serves it and a
tampered copy on `127.0.0.1`, starts `dist/cli.js` over stdio the way an MCP client would, and checks:

```
PASS  tools/list  — verify_manifest, discover_manifest
PASS  valid manifest is accepted  — ACCEPTED: http://127.0.0.1:…/.well-known/proofmeta.json is a valid ProofMeta manifest …
PASS  tampered manifest is rejected  — REJECTED: http://127.0.0.1:…/tampered.json — HASH_MISMATCH at /payload_hash
PASS  404 is rejected  — REJECTED: … — HTTP_STATUS: expected HTTP 200, got 404
PASS  discover_manifest rejects non-FQDN  — REJECTED: (no URL) — DOMAIN_INVALID: …

smoke: 5/5 passed
```

## Library use

```js
import { verifyManifest, discoverManifest, createServer } from "proofmeta-mcp";

const r = await discoverManifest("example.com");
if (r.accepted) use(r.manifest);
```

## Out of scope

`did:web` and other non-`did:key` authors (rejected by the SDK in v1), registries and `discovery_hints`, DNS TXT,
catalog queries, license requests, status chains, payment, delivery, anchors. Write tools (`request_license`,
…) are deliberately not part of this first version.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
