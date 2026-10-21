# Publish a policy

For anyone who publishes content, data, code or tools on a domain and wants AI agents to find a signed, machine-readable statement of what they may do with it. No account, no server, no code.

## What you publish

One signed file at `https://your-domain/.well-known/proofmeta.json`, plus the terms text it hashes and a small page agents are pointed to for requests. The file is a ProofMeta **manifest**: who you are (`did:key`), one or more **license types** with scope tags, and what they cover. Agents fetch it, check the signature, and read the tags before they act.

What the tags mean is fixed by the protocol ([scope-vocabulary.md](./scope-vocabulary.md)). Four ready-made presets cover the common cases:

| Preset                       | Tags                                                                               | In words                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `open-attribution`           | `commercial`, `derivative-allowed`, `attribution-required`, `ai-training-allowed`  | Use, adapt and train on it, commercially too, with credit                       |
| `attribution-no-training`    | `commercial`, `derivative-allowed`, `attribution-required`, `ai-training-excluded` | Use and adapt it with credit; no AI training                                    |
| `non-commercial-no-training` | `non-commercial`, `attribution-required`, `ai-training-excluded`                   | Private, educational, research use with credit; nothing commercial, no training |
| `ask-first`                  | `commercial`, `attribution-required`, `ai-training-excluded`, `revocable`          | Nothing until you answer a request                                              |

A preset writes a plain-language terms text that restates its tags. You can edit that text before publishing; the hash in the manifest is computed over the final file.

## Two ways to create it

**Browser.** Open the [Manifest Generator](https://www.proofmeta.com/generate), enter your name and domain, pick a preset, download the files. Keys are generated in your browser and never leave it.

**Terminal.**

```sh
npx @proofmeta/cli init --name "Your Name" --origin https://your-domain --preset attribution-no-training --contact you@your-domain
```

Both produce the same files:

```
.well-known/proofmeta.json                 the signed manifest
.well-known/proofmeta-terms/<preset>.txt   the terms text the manifest hashes
requests.html                              where agents are sent to ask
proofmeta-key.json                         your signing key — keep private, never upload
README.txt                                 hosting notes per platform
```

## Host it

Upload the first three files, keeping their paths. Serve `proofmeta.json` as `Content-Type: application/json`, UTF-8, without a byte-order mark. Allow cross-origin reads of it so browser tools can fetch it (snippets for nginx, Apache, Vercel, Netlify, Cloudflare Pages and GitHub Pages are in `README.txt`). Do not edit the signed file or the terms text afterwards; re-issue instead.

Check the result:

- [`https://www.proofmeta.com/verify?url=https://your-domain/.well-known/proofmeta.json`](https://www.proofmeta.com/verify)
- `npx @proofmeta/cli fetch your-domain`

## Your key

The manifest is signed with an ed25519 key. Its public half is your identity, a `did:key:z6Mk…` string that appears as `author` and `provider.id`. To change the policy later under the same identity you need the private key, so back the key file up. Set a passphrase (generator: "Encrypt backup"; CLI: `PROOFMETA_PASSPHRASE`) and the file is stored encrypted; either tool reads the other's file.

Losing the key means publishing under a new identity. Nothing breaks, but agents that pinned the old `did:key` will see a different signer.

## What it does and does not do

- It is a signed statement agents can verify: who said it, what exactly, when. The protocol gives agents no excuse not to know your terms.
- It does not enforce anything by itself. An agent that ignores it is in the same position as one that ignores a license page, with one difference: your terms were machine-readable and signed, and anyone can prove it.
- It is a pointer to terms, not a contract. The terms text is yours; the protocol hashes and links it.
- `requests.html` is a static page. Agents that want a signed grant are told how to reach you. An automated endpoint that answers requests with signed statuses is the Provider role, described in [become-a-provider.md](./become-a-provider.md).

## Changing or withdrawing a policy

Re-run the generator or `proofmeta init` with the same key and upload the new files. The new manifest carries a new `timestamp` and `payload_hash`; agents that re-fetch see the new terms. Removing the file withdraws the statement for future readers; it does not undo grants you issued as a Provider.
