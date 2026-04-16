# ProofMeta — Anweisung (Master Specification)

> **What this document is:** The single source of truth for every AI agent, human developer, and tool (Claude Projects, Cursor, OpenClaw, etc.) working on ProofMeta. If it's not in this document, it's not decided yet.

> **Last updated:** 2026-04-16 (all v1 design questions resolved — D1 through D7)

---

## 1. What ProofMeta Is (One Sentence)

ProofMeta is an **open protocol** that lets any AI agent discover, request, and use licensed items from any other AI agent — with cryptographically verifiable terms and a status lifecycle — without the protocol itself handling payments, storage, or blockchain.

---

## 2. First-Principle Rules

These are non-negotiable. Every design decision must pass through these filters:

1. **The protocol is the contract, not the infrastructure.**
   ProofMeta defines *what* agents say to each other. It never defines *how* money moves, *where* files are stored, or *which* chain is used. Those are plug-in concerns.

2. **An agent should be able to participate with a single file.**
   If you can't explain what an agent needs to publish in under 60 seconds, the protocol is too complex.

3. **Status is the only state ProofMeta owns.**
   The protocol tracks one thing: the lifecycle status of a license request. Everything else (payment confirmation, file delivery, identity verification) is reported *to* the protocol by external services.

4. **Machine-first, human-readable second.**
   Every artifact the protocol produces must be parseable by an agent without human intervention. But a human should also be able to read it and understand what's happening.

5. **No vendor lock-in, ever.**
   The protocol must work with Stripe and with Bitcoin Lightning. With Arweave and with S3. With Ethereum and with a plain database. If a design choice forces a specific provider, it violates this rule.

6. **Simplicity over completeness.**
   Ship the smallest useful protocol. Let the ecosystem build the rest.

7. **Everything is a signed envelope.**
   No bare JSON. Every artifact in the protocol — manifests, requests, status updates, reviews — is wrapped in a Signed Envelope (see §3.1). Who, what, when must always be cryptographically verifiable.

8. **Anchoring is optional, not architectural.**
   The protocol defines *how* an envelope can reference an external anchor (on-chain, notary, timestamping service). It never requires one. A ProofMeta deployment with zero chains is as valid as one with five.

---

## 3. Core Concepts

### 3.1 The Signed Envelope (The Protocol's Only Primitive)

**Everything in ProofMeta is a Signed Envelope.** A bare JSON proves nothing — anyone can write anything. For the protocol to be verifiable, every artifact must answer three questions:

1. **Who** wrote this? → `ed25519` signature against `author` key
2. **What** exactly was written? → `sha256` hash of payload
3. **When** and **in what order**? → `timestamp` + optional `in_reply_to`

#### Envelope Structure

```json
{
  "proofmeta": "1.0",
  "payload": { "...": "the actual content" },
  "payload_hash": "sha256:...",
  "author": "did:key:z6Mkh...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-16T10:00:00Z",
  "in_reply_to": "sha256:...",
  "anchors": []
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `proofmeta` | ✅ | Protocol version |
| `payload` | ✅ | The actual content (any JSON object) |
| `payload_hash` | ✅ | `sha256` of the JCS (RFC 8785) canonical serialization of `payload`. See §3.1.1. |
| `author` | ✅ | DID identifying the signer. v1 MUST support `did:key` with ed25519 (see §3.1.2). Other DID methods MAY appear; consumers MAY accept them by policy. |
| `signature` | ✅ | `ed25519` signature over `payload_hash` by author's key |
| `timestamp` | ✅ | ISO 8601 UTC timestamp (author-asserted) |
| `in_reply_to` | ⚠️ context | `payload_hash` of the logically previous envelope in the same lifecycle. Required for status updates and reviews. Omitted for roots (identity, skill publication). |
| `anchors` | ❌ | Optional array of external anchors (see §3.5). Empty array means no anchors. |

#### 3.1.1 Canonical Serialization (JCS / RFC 8785)

Two implementations computing `payload_hash` on the same payload **must** arrive at the same hash. Without a canonical form, `{"a":1,"b":2}` and `{"b":2,"a":1}` would hash differently — and the whole verification chain breaks.

ProofMeta uses **JCS (JSON Canonicalization Scheme, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785))** as the normative canonical form.

**What JCS guarantees:**
- Object keys sorted lexicographically (UTF-16 code unit order)
- No insignificant whitespace
- Numbers serialized per ECMAScript `Number.prototype.toString` rules (deterministic)
- UTF-8 output, no BOM
- Strings escaped per RFC 8259 with canonical escape sequences

**The hashing procedure:**

```
payload_hash = "sha256:" + hex( sha256( jcs_serialize(payload) ) )
```

**Implementation references:**
- TypeScript / JavaScript: [`canonicalize`](https://www.npmjs.com/package/canonicalize)
- Python: [`rfc8785`](https://pypi.org/project/rfc8785/)
- Go: [`jcs`](https://pkg.go.dev/github.com/cyberphone/json-canonicalization)
- Rust: [`serde_jcs`](https://crates.io/crates/serde_jcs)

**What gets canonicalized and what doesn't:**
- `payload_hash` is computed over the canonical form of `payload` **only** — not the whole envelope
- The envelope itself (the outer object with `payload`, `signature`, etc.) has no canonicalization requirement, because nothing hashes over it
- `signature` is computed over `payload_hash` (the string), not over a re-canonicalized envelope — this keeps signing fast and unambiguous

**Why not sorted-keys-JSON or CBOR?**
- Sorted-keys-JSON has no spec and many subtle ambiguities (number formatting, unicode escapes, duplicate keys). Every ad-hoc implementation disagrees in edge cases.
- CBOR is binary and deterministic-CBOR is a solid choice, but ProofMeta is human-readable first (Rule #4). JSON wins.
- JCS is a real IETF standard, shipped in production systems (W3C VC Data Integrity, IETF SCITT), with multiple maintained implementations.

#### 3.1.2 Identity (`author` field)

The `author` field is a [W3C DID](https://www.w3.org/TR/did-core/). A DID is a URI of the form `did:<method>:<method-specific-id>` that resolves — by rules defined per method — to a public key.

**v1 MUST-support method: `did:key` with ed25519**

`did:key` is a self-contained DID method: the public key *is* the identifier. No DNS, no HTTPS, no registry — the verifier extracts the public key directly from the DID string.

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

The `z...` part is the multibase-encoded ed25519 public key with a multicodec prefix. A conforming verifier:
1. Strips the `did:key:` prefix
2. Decodes the multibase (base58-btc) string
3. Strips the multicodec prefix (`0xed01` for ed25519)
4. Uses the remaining 32 bytes as the ed25519 verification key

Reference spec: [did:key Method v0.7](https://w3c-ccg.github.io/did-method-key/)

**Why `did:key` only for v1**
- ✅ Zero infrastructure — works offline, no DNS, no servers, no chains
- ✅ A new Provider Agent can be operational in one line: `keypair = ed25519.generate()`
- ✅ Satisfies Success Criterion #1 ("Provider in under 10 minutes")
- ✅ Forward-compatible — other DID methods can be added later without breaking v1 envelopes

**Other DID methods (`did:web`, `did:ethr`, `did:ion`, ...)**

Envelopes MAY carry any syntactically-valid DID in `author`. The protocol does not forbid it. But v1 implementations only **guarantee** verification of `did:key`. Consumers that want to accept other methods do so by policy — e.g., *"I accept `did:web` if the domain resolves to a `.well-known/did.json` that contains the key."*

`did:web` is planned for v1.1 as an **additive, non-breaking extension** — existing `did:key` envelopes stay valid forever.

**What `author` is NOT**

- Not a human name, not a company name, not an email. Those belong inside the payload (e.g., `payload.provider.name`).
- Not a raw public key. Always a DID — this keeps the format uniform across DID methods.
- Not a placeholder for identity proofs (DNS ownership, GitHub attestations, KYC). Those are separate signed envelopes that reference an `author` DID; see §3.3 for identity-proof extensibility.

#### What Becomes Independently Verifiable

- **Integrity:** `sha256(payload) == payload_hash` → content wasn't altered
- **Authenticity:** `verify(signature, payload_hash, author_pubkey) == true` → author is real
- **Order within a lifecycle:** `in_reply_to` chains status updates of a single request
- **No fake reviews:** a review envelope must reference a valid `GRANTED` envelope hash, same author as the request, one review per grant. Math prevents fraud.

#### What `in_reply_to` Is NOT

`in_reply_to` is **not** a global chain of everything an author ever signed. That would be a blockchain, and ProofMeta is not a blockchain.

It is the semantic equivalent of email threading or ActivityPub replies: it links envelopes **within a single request lifecycle**. The `OPEN` envelope is the root; `PENDING` replies to `OPEN`; `GRANTED` replies to `PENDING`; a review replies to `GRANTED`. That's it.

Envelopes that are roots of their own context (identity registration, skill publication, license objects) have no `in_reply_to`.

### 3.2 Actors

| Actor | What it is | Example |
|-------|-----------|---------|
| **Provider Agent** | An agent that offers licensed items | A music catalog agent, an image library agent, a code snippet agent |
| **Consumer Agent** | An agent that wants to use a licensed item | A marketing agent building a campaign, a developer agent generating an app |
| **Resolver** | An external service that fulfills one part of a transaction | A payment gateway, a chain-anchoring service, a storage service |

### 3.3 The License Manifest

Every Provider Agent publishes a **License Manifest** — a Signed Envelope hosted at a well-known location (like `/.well-known/proofmeta.json`) that describes what it offers and on what terms.

Inspired by:
- `robots.txt` (simple, file-based discovery)
- ERC-7521 (intent-based architecture — agents express desired outcomes, solvers figure out execution)
- OpenAPI (machine-readable capability description)

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "manifest",
    "provider": {
      "id": "did:key:z6MkhBeatVault...",
      "name": "BeatVault Agent",
      "description": "Licensed music loops and stems"
    },
    "catalog_endpoint": "https://beatvault.ai/api/proofmeta/catalog",
    "request_endpoint": "https://beatvault.ai/api/proofmeta/request",
    "status_endpoint": "https://beatvault.ai/api/proofmeta/status",
    "supported_resolvers": {
      "payment": ["stripe", "lightning", "x402-svm"],
      "delivery": ["https", "ipfs", "arweave"],
      "anchor": ["solana-pda", "none"]
    },
    "license_types": [
      {
        "id": "commercial-standard",
        "name": "Standard Commercial License",
        "terms_url": "https://beatvault.ai/terms/commercial",
        "terms_hash": "sha256:a1b2c3...",
        "price_hint": { "amount": "5.00", "currency": "USD" },
        "scope": ["commercial", "derivative", "ai-training-excluded"]
      },
      {
        "id": "free-attribution",
        "name": "Free with Attribution",
        "terms_url": "https://beatvault.ai/terms/free",
        "terms_hash": "sha256:d4e5f6...",
        "price_hint": { "amount": "0", "currency": "USD" },
        "scope": ["non-commercial", "attribution-required"]
      }
    ]
  },
  "payload_hash": "sha256:...",
  "author": "did:key:z6MkhBeatVault...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-16T09:00:00Z",
  "anchors": []
}
```

**Key design decisions:**
- The whole manifest is a Signed Envelope. A consumer can verify the provider actually signed it.
- `terms_hash` — the license text is hashed so agents can verify it hasn't changed since they agreed
- `price_hint` — a *hint*, not a binding price. Actual price is confirmed during the request flow
- `supported_resolvers` — tells the Consumer which payment, delivery and anchor options the provider will accept. The Consumer picks one it also supports. `"anchor": ["none"]` is valid.
- `scope` — simple string array describing what the license allows. Deliberately not a complex rights language — keep it simple, let lawyers write the full terms at `terms_url`.

### 3.4 The Status Lifecycle

This is the heart of ProofMeta. Every license request moves through exactly these states:

```
OPEN → PENDING → GRANTED | DENIED
                 GRANTED → REVOKED (optional)
```

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `OPEN` | Consumer Agent has submitted a request | Consumer (signs the envelope) |
| `PENDING` | A Resolver is processing (e.g., payment is in progress) | Resolver or Provider |
| `GRANTED` | License is active. Consumer can use the item | Provider Agent (after Resolver confirms) |
| `DENIED` | Request was rejected (payment failed, terms violated, etc.) | Provider Agent or Resolver |
| `REVOKED` | A previously granted license has been withdrawn | Provider Agent |

**Each state transition is its own Signed Envelope.** `PENDING.in_reply_to == OPEN.payload_hash`. `GRANTED.in_reply_to == PENDING.payload_hash`. The chain of envelopes *is* the proof of the lifecycle.

**ProofMeta does not care *why* a status changes.** It only records *that* it changed, *when*, and *who* changed it. The reason is metadata attached by the actor who made the change.

### 3.5 Anchors (Optional External Witnesses)

An **anchor** is an optional, external reference attached to an envelope that provides third-party evidence of its existence. Anchors are pluggable — the protocol defines the interface, resolvers implement specific anchor types.

#### Three Trust Tiers Using the Same Envelope Format

**Tier 1 — Pure Signature**
`Envelope → signed → done.` Trust comes from author's key identity (DID, DNS, Reclaim). Good for free licenses, internal agent networks, low-stakes flows. `anchors: []`.

**Tier 2 — Hash Chain (in_reply_to)**
`OPEN → PENDING → GRANTED`, each envelope replies to the previous. Trust comes from signature + lifecycle order. Good for proof-of-use reviews, bilateral records between provider and consumer. `anchors: []` still possible.

**Tier 3 — External Anchor**
Each envelope (or selected ones) additionally anchored to an external system — on-chain PDA, notary service, RFC 3161 timestamp, Arweave transaction. Trust comes from third-party witness. Good for high-stakes licenses, legal disputes, "this existed at time X and has not been altered since."

#### Anchor Structure

```json
"anchors": [
  {
    "type": "solana-pda",
    "chain": "solana-mainnet",
    "reference": "5xY7Kq2...",
    "slot": 298472910
  },
  {
    "type": "rfc3161",
    "authority": "https://freetsa.org",
    "reference": "base64:MIID..."
  }
]
```

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | ✅ | Anchor-type identifier (e.g. `solana-pda`, `evm-contract`, `arweave-tx`, `rfc3161`) |
| `reference` | ✅ | The actual anchor reference (PDA address, tx hash, signed timestamp blob) |
| `chain` / `authority` | ⚠️ type-specific | Network or issuing authority identifier |
| *(anything else)* | ❌ | Type-specific metadata (block, slot, tx, height, etc.) |

#### What the Protocol Defines About Anchors

- The **shape** of an anchor entry (`type` + `reference` + type-specific fields)
- That `anchors` is an **array** (an envelope may have zero or many anchors)
- That anchors are **additive evidence**, never required for signature/hash validity

#### What the Protocol Does NOT Define

- Which chains or authorities are "valid"
- Whether an anchor is required (that's a consumer-side policy)
- How to create an anchor (resolver job)
- How to verify an anchor (resolver or verifier job)

A consumer can implement any policy it wants: *"I only accept envelopes anchored on Solana mainnet"* or *"I only require signatures, anchors are nice-to-have"*. Both are valid ProofMeta usage.

### 3.6 The License Request Envelope

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "license.request",
    "request_id": "req_abc123",
    "consumer": {
      "id": "did:key:z6MkhMarketingAgent...",
      "callback_url": "https://marketingagent.ai/proofmeta/callback"
    },
    "provider_id": "did:key:z6MkhBeatVault...",
    "item_id": "beat-001",
    "license_type": "commercial-standard",
    "terms_hash": "sha256:a1b2c3...",
    "resolver_preferences": {
      "payment": "stripe",
      "delivery": "https",
      "anchor": "none"
    },
    "status": "OPEN"
  },
  "payload_hash": "sha256:...",
  "author": "did:key:z6MkhMarketingAgent...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-16T10:00:00Z",
  "anchors": []
}
```

This is the `OPEN` envelope. It has no `in_reply_to` because it is the root of its lifecycle.

A subsequent `GRANTED` envelope from the provider would look like:

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "status.update",
    "request_id": "req_abc123",
    "status": "GRANTED",
    "note": "Payment confirmed by Stripe resolver",
    "delivery": { "method": "https", "url": "https://beatvault.ai/d/xyz" }
  },
  "payload_hash": "sha256:...",
  "author": "did:key:z6MkhBeatVault...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-16T10:01:30Z",
  "in_reply_to": "sha256:<PENDING-envelope-hash>",
  "anchors": [
    { "type": "solana-pda", "chain": "solana-mainnet", "reference": "5xY7Kq2...", "slot": 298472910 }
  ]
}
```

### 3.7 Discovery

Discovery answers one question: **"Given that I know a Provider exists, how do I get their signed Manifest?"**

ProofMeta answers this with one mechanism in v1:

#### The Well-Known URL

A Provider that has a domain publishes their Manifest envelope at:

```
https://{domain}/.well-known/proofmeta.json
```

A Consumer that knows the domain performs one HTTPS GET to retrieve it. That's the entire v1 discovery protocol.

The Manifest is a Signed Envelope (§3.3), so its authenticity is independent of the URL. A Consumer that obtained the Manifest over HTTPS, from IPFS, via email, or scribbled on a napkin can still verify it — the signature proves the `author` DID signed it.

#### Providers Without a Domain

v1 permits any resolvable URL for Manifest hosting, not just `https://`. Valid examples:

- `https://beatvault.ai/.well-known/proofmeta.json` (self-hosted)
- `https://username.github.io/proofmeta.json` (free hosting)
- `ipfs://bafybeig.../proofmeta.json` (content-addressed, immutable)
- `ar://abc.../proofmeta.json` (Arweave, permanent)

The Consumer needs **any URL** at which the Manifest can be fetched. The Well-Known convention applies only when a Provider controls a domain.

#### Discovery Is Not Exploration

Two different problems, often conflated:

| Problem | Example question | Solved by |
|---------|------------------|-----------|
| **Discovery** | "What does Provider X offer?" | ProofMeta (Well-Known URL) |
| **Exploration** | "Which Providers offer music loops?" | Ecosystem (Registries, search engines, directories) |

ProofMeta solves Discovery. Exploration is **explicitly out of scope**, for the same reason Payment is: it's a product concern, not a protocol concern.

#### Registries Are Plug-ins, Not Protocol

The ecosystem will build Registries. They might be on-chain, off-chain, community-run, commercial, curated, open. That is fine — and it is **not ProofMeta's job**.

A Registry that wants to interoperate with ProofMeta can do exactly one thing: it indexes Manifests (which are Signed Envelopes anyway). It does not need protocol permission. It does not need a spec. It does not get to define anything.

Corollary: **v1 Consumers never depend on a Registry being available.** A Consumer that knows a Provider's Manifest URL (however it learned this URL) can operate fully. That is the ProofMeta contract.

#### `discovery_hints` (v1.1, optional, non-breaking)

In v1.1 the Manifest payload MAY optionally include a `discovery_hints` field with pointers to registries that list this Provider. Purely informational. Consumers MAY ignore it entirely. Consumers MUST NOT require it. The exact shape will be specified when v1.1 ships.

#### Why Not DNS TXT Records?

DNS TXT (`_proofmeta.example.com`) was considered. Rejected for v1 because:

- It adds a second lookup before the HTTPS GET that happens anyway
- Requiring DNS config pushes the "Provider in 10 minutes" benchmark (Success Criterion #1) out of reach for developers on shared hosting
- It does not solve a problem the Well-Known URL does not already solve

DNS TXT may return as a v2 hint mechanism for Providers whose Well-Known URL is unstable. For v1 it is unnecessary complexity.

#### Why Not On-Chain Registry?

Rejected outright. It violates First-Principle Rules #1 (protocol ≠ infrastructure), #5 (no vendor lock-in), and #6 (simplicity). Any chain-based registry MUST be a plug-in, never core.

### 3.8 Catalog Query

After Discovery (§3.7), a Consumer has the Manifest and knows the `catalog_endpoint`. This section defines how to query it.

#### Required Parameters

Every `catalog_endpoint` MUST accept these query parameters via HTTP GET:

| Parameter | Type | Required | Meaning |
|-----------|------|----------|---------|
| `q` | string | ❌ | Free-text search. Provider decides matching strategy (substring, fuzzy, embedding-based — not the protocol's concern). If omitted, return all items (subject to `limit`). |
| `license_type` | string | ❌ | Filter by license type ID (must match an `id` from the manifest's `license_types` array). |
| `limit` | integer | ❌ | Maximum number of results to return. Default: 20. Max: 100. |
| `offset` | integer | ❌ | Number of results to skip (for pagination). Default: 0. |

All parameters are optional. A bare `GET /catalog` with no parameters returns the first page of all available items.

**Example request:**

```
GET /catalog?q=lofi+beats&license_type=free-attribution&limit=10&offset=0
```

#### Response Format

The response is a plain JSON object (NOT a Signed Envelope — catalog results are ephemeral search results, not binding commitments).

```json
{
  "items": [
    {
      "item_id": "beat-001",
      "name": "Sunset Lofi Loop",
      "description": "80 BPM lofi hip-hop loop, 16 bars",
      "available_licenses": ["commercial-standard", "free-attribution"],
      "metadata": {}
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `items` | ✅ | Array of item stubs |
| `items[].item_id` | ✅ | Unique identifier for this item (used in license requests) |
| `items[].name` | ✅ | Human-readable name |
| `items[].description` | ❌ | Short description |
| `items[].available_licenses` | ✅ | Array of license type IDs this item can be licensed under |
| `items[].metadata` | ❌ | Provider-specific metadata (format, duration, tags, etc.). Opaque to the protocol. |
| `total` | ✅ | Total number of matching items (for pagination) |
| `limit` | ✅ | Echoed back |
| `offset` | ✅ | Echoed back |

#### Why Not Signed Envelopes for Catalog Results?

Catalog results are search output — they change, they're ranked, they're filtered. They are not commitments. The binding commitment happens when the Provider responds to a License Request with a `PENDING` or `GRANTED` envelope. Signing every search result would add overhead without trust benefit.

#### Provider Extensions

Providers MAY accept additional query parameters beyond the four required ones (e.g., `genre`, `bpm_min`, `bpm_max`, `format`). The Manifest MAY document these extensions, but the protocol does not standardize them. A Consumer that doesn't understand an extension simply doesn't send it — the four base parameters always work.

---

## 4. What ProofMeta Owns vs. What Others Own

This is the most important architectural boundary.

### ProofMeta Core (WE build and maintain this)

| Component | Description |
|-----------|-------------|
| **Envelope Spec** | The JSON schema for Signed Envelopes, including canonical serialization rules |
| **Manifest Spec** | The envelope-wrapped manifest at `/.well-known/proofmeta.json` |
| **Request/Status Spec** | Envelope schemas for license requests, status updates, reviews |
| **Status Lifecycle** | The state machine (OPEN → PENDING → GRANTED/DENIED → REVOKED) and the valid `in_reply_to` transitions |
| **Anchor Interface** | The shape of the `anchors` array — not the anchor types themselves |
| **Discovery Spec** | The Well-Known URL convention (`/.well-known/proofmeta.json`). Nothing else. |
| **Catalog Query Spec** | The four standard query parameters (`q`, `license_type`, `limit`, `offset`) and the response format. See §3.8. |
| **Reference SDK** | Lightweight libraries (TypeScript, Python) that implement envelope creation, signing, verification |
| **Validator** | A tool that checks if an envelope or manifest is spec-compliant |
| **Reference Agent** | A minimal working agent that demonstrates the protocol end-to-end |

### External / Plug-in (OTHERS build, or we integrate existing solutions)

| Concern | Examples | ProofMeta's role |
|---------|----------|-----------------|
| **Payment** | Stripe, Lightning Network, ERC-20, x402-SVM | Define the Resolver interface. Payment providers implement it. |
| **Anchoring / Verification** | Solana PDAs, EVM contracts, Arweave, RFC 3161 timestamping | Define the shape of an anchor entry. Anchor implementations live outside core. |
| **Storage / Delivery** | IPFS, Arweave, S3, direct HTTPS | Define the delivery callback interface. Storage providers implement it. |
| **Identity** | DIDs, ENS, OAuth, API keys, DNS proofs, Reclaim ZK proofs | Define that `author` is a DID. v1 mandates `did:key`. Other methods are opt-in by consumer policy. |
| **Registries / Directories / Exploration** | Community directories, on-chain registries, search engines, curated marketplaces | Out of scope. Registries index Signed Manifests (which are self-authenticating anyway) and need no protocol permission. |
| **Catalog search implementation** | Full-text search, recommendation engines, AI embeddings | ProofMeta defines the query interface (§3.8). What powers the search behind the endpoint is the Provider's business. |
| **Legal / Terms** | License text, jurisdiction, compliance | ProofMeta links to terms via URL + hash. Writing the actual legal text is not our job. |
| **UI / Dashboard** | Web apps, admin panels, analytics | Not core protocol. Community or commercial add-ons. |

---

## 5. ERC-7521 Alignment

ERC-7521 defines **generalized intents for smart contract wallets** — users express what they *want* (an intent), and solvers compete to find the best way to fulfill it.

ProofMeta borrows this philosophy:

| ERC-7521 Concept | ProofMeta Equivalent |
|-----------------|---------------------|
| UserIntent | License Request Envelope — "I want to use item X under terms Y" |
| IntentSolution | Resolver execution — a payment provider + delivery method that fulfills the request |
| EntryPoint contract | The Status Lifecycle — the central trust point that validates state transitions |
| Intent Standards | Resolver interfaces — pluggable definitions of how payment/delivery/anchor work |
| Solvers/Searchers | Resolvers — external services that compete to fulfill parts of the request |

**Practical integration path:**
- A ProofMeta request envelope *can* be wrapped as an ERC-7521 UserIntent for on-chain execution
- The Resolver interface *can* be implemented as an ERC-7521 Intent Standard contract
- Anchors *can* be ERC-7521 solution receipts
- But none of this is *required* — ProofMeta works equally well off-chain with REST APIs and pure signatures

**Status:** This section is conceptual orientation only. A formal ERC-7521 wrapping interface is deferred to v2, pending real-world resolver experience from v1.1 (see D6).

---

## 6. Agent Discovery Flow

The full end-to-end flow, from "I know a Provider's domain" to "I have a signed GRANTED envelope." Steps 1–2 are Discovery (§3.7). Steps 3–8 are the License Lifecycle (§3.4, §3.6).

```
Consumer Agent                     Provider Agent
      |                                   |
      |  1. GET manifest URL              |
      |     (typically                    |
      |      https://{domain}/.well-known/proofmeta.json,
      |      but any URL is valid)        |
      |─────────────────────────────────►|
      |                                   |
      |  2. Manifest envelope             |
      |     Consumer verifies:            |
      |      - JCS hash matches payload   |
      |      - ed25519 signature valid    |
      |      - author DID resolves to     |
      |        the signing key            |
      |◄─────────────────────────────────|
      |                                   |
      |  3. GET /catalog?query=...        |
      |─────────────────────────────────►|
      |                                   |
      |  4. Catalog results               |
      |◄─────────────────────────────────|
      |                                   |
      |  5. POST /request                 |
      |     (signed OPEN envelope)        |
      |─────────────────────────────────►|
      |                                   |
      |  6. Signed PENDING envelope       |
      |     (in_reply_to: OPEN.hash)      |
      |◄─────────────────────────────────|
      |                                   |
      |        ... Resolver does work ... |
      |                                   |
      |  7. Signed GRANTED envelope       |
      |     (in_reply_to: PENDING.hash,   |
      |      anchors: [...] optional)     |
      |◄─────────────────────────────────|
      |                                   |
      |  8. GET /status/{request_id}      |
      |     (anytime, returns envelope    |
      |      chain for verification)      |
      |─────────────────────────────────►|
```

---

## 7. Development Tooling & Workflow

### 7.1 Claude Projects (this file)

Drop this Anweisung into your Claude Project as the system prompt / project knowledge. Every conversation in that project will have full context on:
- The Signed Envelope primitive
- What's core vs. external
- The status lifecycle
- The anchor interface

### 7.2 Cursor

Use this same file as `PROOFMETA_ANWEISUNG.md` in your repo root. Cursor will index it and use it as context when you're coding. Add a `.cursorrules` file that references it:

```
# .cursorrules
Read PROOFMETA_ANWEISUNG.md before making any architectural decisions.
ProofMeta is a protocol, not a platform.
Everything is a Signed Envelope — no bare JSON ever.
payload_hash MUST be sha256 over JCS (RFC 8785) canonical form of payload. Never roll your own canonicalization.
author MUST be a DID. v1 only guarantees verification of did:key with ed25519. Do not implement did:web or other DID methods without an explicit spec update.
Discovery in v1 is a single HTTPS GET to a Manifest URL (typically /.well-known/proofmeta.json). Do not build, assume, or depend on a registry.
The status lifecycle (OPEN → PENDING → GRANTED/DENIED → REVOKED) is sacred.
in_reply_to chains envelopes within a single request lifecycle — it is NOT a blockchain.
Anchors are optional, pluggable, and never required by the protocol.
Never hardcode a payment provider, storage backend, chain, or anchor type.
All external concerns go through the Resolver interface.
```

### 7.3 OpenClaw (Agent Setup)

OpenClaw agents can be structured around ProofMeta's separation of concerns:

| OpenClaw Agent | Role |
|---------------|------|
| **Spec Agent** | Maintains envelope + manifest JSON schemas, validates compliance |
| **SDK Agent** | Writes and tests the reference TypeScript/Python SDKs (envelope creation, signing, verification) |
| **Resolver Agent** | Builds reference resolver implementations (payment, delivery, anchor) |
| **Demo Agent** | Builds and runs the reference Provider + Consumer agents |
| **Docs Agent** | Keeps documentation, examples, and tutorials in sync with the spec |

### 7.4 Claude Code (Agentic Option)

For agentic development sessions, you can use Claude Code to:
- Scaffold the entire repo structure based on this spec
- Generate the JSON Schema files from the envelope examples
- Write the reference SDK with tests
- Build a working demo with two agents transacting

Prompt pattern for Claude Code:
```
Read PROOFMETA_ANWEISUNG.md. Then scaffold the repo:
/packages/spec        → JSON Schemas (envelope, manifest, request, status, review)
/packages/core        → TypeScript SDK — zero chain deps, only tweetnacl + @noble/hashes
/packages/sdk-py      → Python SDK
/packages/resolvers   → Reference resolver implementations (free, stripe, solana-anchor)
/examples/provider    → Demo provider agent
/examples/consumer    → Demo consumer agent
```

---

## 8. v1 Scope (What to Build First)

### In scope for v1
- [ ] Signed Envelope spec (JSON Schema + JCS/RFC 8785 canonical serialization rules)
- [ ] Manifest spec (envelope-wrapped)
- [ ] Catalog query spec (standard parameters + response format, §3.8)
- [ ] License Request / Status Update envelope schemas
- [ ] Status lifecycle state machine with `in_reply_to` validation
- [ ] Anchor interface definition (just the shape — no specific anchor types required)
- [ ] Reference TypeScript SDK: create/sign/verify envelopes, walk `in_reply_to` chain, publish manifest, submit request, check status
- [ ] One reference Resolver (Free / no-op — instant GRANTED, no payment, no anchor)
- [ ] Two demo agents (Provider, Consumer) completing a full Tier 1 flow (pure signature, no anchors)
- [ ] Validator CLI tool (`proofmeta validate envelope.json`) — checks schema compliance, JCS-correct hash, valid signature, and `in_reply_to` chain integrity
- [ ] Canonical spec domain (e.g. `spec.proofmeta.org` or `proofmeta.dev`) — hosts the released spec version. GitHub remains the development repo.

### Target for v1.1 (still core, but after MVP)
- [ ] One payment resolver (Stripe or x402-SVM)
- [ ] One anchor resolver (Solana PDA) as proof the interface works
- [ ] Demo showing Tier 3 flow (signature + in_reply_to + Solana anchor)
- [ ] ERC-7521 wrapping interface (informed by real resolver experience)

### Explicitly NOT in scope for v1
- ERC-7521 formal wrapping spec (deferred to v2, §5 remains as orientation)
- Requiring on-chain for any core flow (Tier 3 must remain opt-in)
- Agent registry / discovery network — v1 uses direct URLs
- Complex rights management — v1 uses simple scope arrays
- Payment splitting / royalties — v1 handles single-party payments
- UI / dashboard — v1 is API-only

---

## 9. Success Criteria

ProofMeta v1 is done when:

1. **A developer can make their agent a Provider in under 10 minutes** — generate a key, publish a signed manifest, respond to request envelopes with signed status envelopes
2. **A developer can make their agent a Consumer in under 10 minutes** — discover a Provider, send a signed request, verify returned status envelopes
3. **A free license flow works end-to-end with zero external dependencies** — no blockchain, no payment, no anchor. Just two agents, signatures, and the protocol.
4. **A paid license flow works end-to-end with one Resolver** — e.g., Stripe Checkout as payment resolver
5. **A Tier 3 flow works with one anchor resolver** — e.g., Solana PDA — proving the anchor interface is real and pluggable
6. **The spec is small enough to fit in a single AI context window** — if an agent can't understand the full protocol in one prompt, it's too complex

---

## 10. Open Questions (To Decide)

All v1 design questions have been resolved. New questions will be added here as they arise during implementation.

### Decided Questions (locked in)

| # | Question | Decision | Date |
|---|----------|----------|------|
| D1 | Canonical serialization for `payload_hash` | **JCS (RFC 8785)** — JSON Canonicalization Scheme | 2026-04-16 |
| D2 | Licensing of ProofMeta (spec + code) | **Apache-2.0** for everything — code, spec, schemas, examples. Attribution required via `NOTICE` file. Copyright holder: Daud Zulfacar, Pandr UG (haftungsbeschränkt). | 2026-04-16 |
| D3 | Identity method for v1 | **`did:key` with ed25519** is the only MUST-support method for v1. Syntactically-valid other DIDs MAY be present in `author` fields and consumers MAY accept them. `did:web` is planned for v1.1 as an additive extension (non-breaking). | 2026-04-16 |
| D4 | Manifest discovery mechanism | **Well-Known URL only** for v1 — manifest lives at `https://{domain}/.well-known/proofmeta.json` (or any URL the consumer already knows). Manifest is a Signed Envelope so its authenticity is independent of where it is hosted. Registries are explicitly **out of scope**. See §3.7. | 2026-04-16 |
| D5 | Catalog query language | **Minimal standard parameters.** Every `catalog_endpoint` MUST accept: `q` (free-text search), `license_type` (filter by license type ID from manifest), `limit`/`offset` (pagination). Providers MAY support additional parameters. Response is a JSON array of item stubs (not Signed Envelopes — catalog results are ephemeral, not binding). See §3.8. | 2026-04-16 |
| D6 | ERC-7521 wrapping | **Deferred to v2.** §5 remains as philosophical alignment and conceptual mapping. No formal wrapping interface will be specified until real-world resolver experience (especially the Solana resolver in v1.1) provides data on what the interface actually needs. | 2026-04-16 |
| D7 | Where the canonical spec lives | **Dedicated domain** (e.g. `spec.proofmeta.org` or `proofmeta.dev`). GitHub (`github.com/bettabeta/proofmeta`) is the development repo. The domain hosts the current released spec version. Setup is a v1 launch task. | 2026-04-16 |

---

## 11. License & Attribution

ProofMeta is created and maintained by **Daud Zulfacar, Pandr UG (haftungsbeschränkt)**.

The specification, reference SDKs, JSON Schemas, example agents, and all other material in this repository are licensed under the **Apache License, Version 2.0**.

- Full license text: [`LICENSE`](./LICENSE)
- Required attribution notice: [`NOTICE`](./NOTICE)

### What this means in practice

- ✅ You may use ProofMeta commercially, embed it in closed-source products, fork it, modify it, redistribute it.
- ✅ You may build proprietary agents, resolvers, and services on top of ProofMeta without any copyleft obligation.
- ⚠️ You **must** preserve copyright notices, the `LICENSE` file, and the contents of the `NOTICE` file when redistributing.
- ⚠️ You **must** state significant changes you made to the source files.
- ⚠️ Apache-2.0 includes a patent grant — if you sue anyone over patents covering your contribution, you lose the license.

### Required attribution

Any implementation, fork, or derivative of ProofMeta must retain the attribution contained in the `NOTICE` file:

> ProofMeta
> Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
> Licensed under the Apache License, Version 2.0

Source files include SPDX identifiers for automated license tooling:

```typescript
// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
```

---

*This is a living document. Update it as decisions are made. Every agent in the toolchain reads from this file.*