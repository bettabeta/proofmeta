# ProofMeta Protocol

> The permission layer for the agentic web — an open protocol that lets any AI agent discover, request, and use licensed items from any other AI agent, with machine-readable terms and a status lifecycle.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Status: Draft](https://img.shields.io/badge/Status-Draft-yellow)]()

---

## What is ProofMeta?

ProofMeta is a **protocol**, not a platform. It defines what agents say to each other when licensing content or capabilities. It never defines how money moves, where files are stored, or which blockchain is used.

- **Provider Agent** — publishes a manifest, offers licensed items
- **Consumer Agent** — discovers providers, requests licenses
- **Resolver** — external service that handles payment, delivery, or verification

## Core Principles

1. The protocol is the contract, not the infrastructure
2. An agent should be able to participate with a single file
3. Status is the only state ProofMeta owns
4. Machine-first, human-readable second
5. No vendor lock-in, ever
6. Simplicity over completeness

## Status Lifecycle

```
OPEN → PENDING → GRANTED | DENIED
                 GRANTED → REVOKED (optional)
```

## Quick Start

A Provider Agent publishes a manifest at `/.well-known/proofmeta.json`:

```json
{
  "proofmeta": "1.0",
  "provider": {
    "id": "your-agent-id",
    "name": "Your Agent Name"
  },
  "catalog_endpoint": "https://youragent.ai/api/proofmeta/catalog",
  "request_endpoint": "https://youragent.ai/api/proofmeta/request",
  "status_endpoint": "https://youragent.ai/api/proofmeta/status",
  "supported_resolvers": {
    "payment": ["stripe", "lightning"],
    "delivery": ["https", "ipfs"],
    "verification": ["signed-jwt"]
  },
  "license_types": [
    {
      "id": "free-attribution",
      "name": "Free with Attribution",
      "terms_url": "https://youragent.ai/terms/free",
      "terms_hash": "sha256:...",
      "price_hint": { "amount": "0", "currency": "USD" },
      "scope": ["non-commercial", "attribution-required"]
    }
  ]
}
```

## Repository Structure

```
/packages/spec          → JSON Schemas (manifest, request, status)
/packages/sdk-ts        → TypeScript SDK
/packages/resolvers     → Reference resolver implementations
/examples/provider      → Demo Provider Agent
/examples/consumer      → Demo Consumer Agent
/docs                   → Specification documentation
```

## v1 Scope

- [x] Manifest spec
- [ ] Request/Response spec
- [ ] Status lifecycle state machine
- [ ] TypeScript SDK
- [ ] Reference Resolver (free/open license)
- [ ] Demo Provider + Consumer agents
- [ ] Validator CLI (`proofmeta validate manifest.json`)

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE)
