# ProofMeta — Anweisung (Master Specification)

> **What this document is:** The single source of truth for every AI agent, human developer, and tool (Claude Projects, Cursor, OpenClaw, etc.) working on ProofMeta. If it's not in this document, it's not decided yet.

> **Last updated:** 2026-04-16

---

## 1. What ProofMeta Is (One Sentence)

ProofMeta is an **open protocol** that lets any AI agent discover, request, and use licensed items from any other AI agent — with machine-readable terms and a status lifecycle — without the protocol itself handling payments, storage, or blockchain.

---

## 2. First-Principle Rules

1. **The protocol is the contract, not the infrastructure.**
2. **An agent should be able to participate with a single file.**
3. **Status is the only state ProofMeta owns.**
4. **Machine-first, human-readable second.**
5. **No vendor lock-in, ever.**
6. **Simplicity over completeness.**

---

## 3. Core Concepts

### 3.1 Actors

| Actor | What it is |
|-------|-----------|
| **Provider Agent** | An agent that offers licensed items |
| **Consumer Agent** | An agent that wants to use a licensed item |
| **Resolver** | An external service that fulfills one part of a transaction |

### 3.2 Status Lifecycle

```
OPEN → PENDING → GRANTED | DENIED
                 GRANTED → REVOKED (optional)
```

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `OPEN` | Request submitted | Protocol (automatic) |
| `PENDING` | Resolver is processing | Resolver |
| `GRANTED` | License is active | Provider Agent |
| `DENIED` | Request rejected | Provider Agent or Resolver |
| `REVOKED` | License withdrawn | Provider Agent |

### 3.3 Key Files

- `/.well-known/proofmeta.json` — Provider manifest (discovery)
- `/packages/spec/manifest.schema.json` — JSON Schema for manifest
- `/packages/spec/request.schema.json` — JSON Schema for license requests
- `/packages/spec/status.schema.json` — JSON Schema for status GET response (draft)

---

## 4. What ProofMeta Owns vs. What Others Own

### ProofMeta Core
- Manifest Spec
- Request/Response Spec
- Status Lifecycle
- Discovery Spec
- Reference SDK (TypeScript)
- Validator CLI
- Reference Agents (Provider + Consumer demo)

### External / Plug-in
- Payment (Stripe, Lightning, ERC-20)
- Blockchain / Verification (Ethereum, Solana, Arweave)
- Storage / Delivery (IPFS, S3, HTTPS)
- Identity (DIDs, API keys)
- Catalog / Search
- Legal text
- UI / Dashboard

---

## 5. Repo Structure

```
/packages/spec          → JSON Schemas
/packages/sdk-ts        → TypeScript SDK
/packages/resolvers     → Reference resolver implementations
/examples/provider      → Demo Provider Agent
/examples/consumer      → Demo Consumer Agent
/docs                   → Spec documentation
PROOFMETA_ANWEISUNG.md  → This file
.cursorrules            → Cursor IDE rules
```

---

## 6. v1 Scope

### In scope
- [ ] Manifest spec (JSON Schema) ✓
- [ ] Request/Response spec (JSON Schema) ✓
- [ ] Status lifecycle state machine
- [ ] TypeScript SDK
- [ ] One reference Resolver (free/open license)
- [ ] Two demo agents (Provider + Consumer)
- [ ] Validator CLI (`proofmeta validate manifest.json`)

### NOT in scope for v1
- On-chain anything
- Agent registry / discovery network
- Complex rights management
- Payment splitting / royalties
- UI / dashboard

---

## 7. Open Questions

| # | Question | Decision |
|---|----------|----------|
| 1 | Manifest discovery | `/.well-known/proofmeta.json` ✓ |
| 2 | Identity for v1 | API keys (DIDs in v2) |
| 3 | Catalog query language | Freeform query params |
| 4 | ERC-7521 wrapping | v2 |
| 5 | Protocol license | GPL v3 ✓ |
| 6 | Canonical spec location | github.com/bettabeta/proofmeta |

---

*This is a living document. Update it as decisions are made.*
