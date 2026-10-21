// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Policy presets shared by `proofmeta init` and the browser generator
 * (site/generate/presets.js carries the same table; scripts/test/presets-parity
 * keeps them identical). Every preset is one license type whose scope uses
 * only core tags from docs/scope-vocabulary.md. Presets do not add protocol
 * semantics; they only pick tags and generate a plain-language terms text
 * that restates those tags.
 */

export const SCOPE_MEANING = {
  "commercial": "commercial use allowed",
  "non-commercial": "non-commercial use only",
  "derivative-allowed": "derivative works allowed",
  "attribution-required": "attribution required",
  "ai-training-allowed": "AI training allowed",
  "ai-training-excluded": "AI training not allowed",
  "sublicense-allowed": "sublicensing allowed",
  "revocable": "publisher may revoke",
};

export const PRESETS = [
  {
    id: "open-attribution",
    name: "Open with attribution",
    summary: "Anyone may use, adapt and train on it, commercially too, as long as they credit you.",
    scope: ["commercial", "derivative-allowed", "attribution-required", "ai-training-allowed"],
    request_required: false,
  },
  {
    id: "attribution-no-training",
    name: "Attribution, no AI training",
    summary: "Anyone may use and adapt it with credit, including commercially. AI training is not allowed.",
    scope: ["commercial", "derivative-allowed", "attribution-required", "ai-training-excluded"],
    request_required: false,
  },
  {
    id: "non-commercial-no-training",
    name: "Non-commercial, no AI training",
    summary: "Private, educational and research use with credit. No commercial use, no AI training.",
    scope: ["non-commercial", "attribution-required", "ai-training-excluded"],
    request_required: false,
  },
  {
    id: "ask-first",
    name: "Ask first",
    summary: "Nothing is granted until you answer a request. Agents see the terms and know where to ask.",
    scope: ["commercial", "attribution-required", "ai-training-excluded", "revocable"],
    request_required: true,
  },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Plain-language terms text for one preset. The protocol hashes this text
 * (`terms_hash`) and links it (`terms_url`); the text itself is not a
 * protocol artifact and the publisher may edit it before publishing.
 */
export function termsText({ preset, publisher, origin, date }) {
  const allowed = [];
  const forbidden = [];
  const obligations = [];
  const s = new Set(preset.scope);
  if (s.has("commercial")) allowed.push("commercial use, including in paid products and services");
  if (s.has("non-commercial")) {
    allowed.push("private, educational and research use");
    forbidden.push("commercial use of any kind");
  }
  if (s.has("derivative-allowed")) allowed.push("derivative works such as adaptations, translations and remixes");
  else forbidden.push("derivative works, unless separately agreed");
  if (s.has("ai-training-allowed")) allowed.push("use as training data for machine-learning models");
  if (s.has("ai-training-excluded")) forbidden.push("use as training data for machine-learning models");
  if (s.has("sublicense-allowed")) allowed.push("sublicensing under the same or more restrictive terms");
  else forbidden.push("sublicensing to third parties");
  if (s.has("attribution-required")) obligations.push(`credit ${publisher} and link to ${origin} wherever the material is used`);
  if (s.has("revocable")) obligations.push("stop using the material if the publisher revokes the license");

  const lines = [
    `Usage terms for material published by ${publisher} at ${origin}`,
    `Version ${date}`,
    "",
    "These terms are published as machine-readable license terms under the ProofMeta protocol.",
    `They apply to the material listed in the signed manifest at ${origin}/.well-known/proofmeta.json.`,
    "",
    preset.request_required
      ? "No use is permitted before the publisher has answered a license request with a GRANTED status. Send requests to the request endpoint declared in the manifest."
      : "Anyone who complies with these terms may use the material without sending a request. A license request is optional and gives you a signed record of the grant.",
    "",
    "Permitted:",
    ...allowed.map((a) => `  - ${a}`),
    "",
    "Not permitted:",
    ...(forbidden.length ? forbidden.map((f) => `  - ${f}`) : ["  - nothing beyond what applicable law already forbids"]),
    "",
    "Obligations:",
    ...(obligations.length ? obligations.map((o) => `  - ${o}`) : ["  - none"]),
    "",
    `Machine-readable scope tags: ${preset.scope.join(", ")}`,
    "",
    "This text is a plain-language policy, not legal advice. Where it is silent, applicable law applies.",
    "",
  ];
  return lines.join("\n");
}

/** Static page served at the manifest's `request_endpoint` for publishers without an automated endpoint. */
export function requestsHtml({ publisher, origin, preset, contact, termsUrl }) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const contactLine = contact
    ? `<p>To reach the publisher: <a href="${esc(contact)}">${esc(contact.replace(/^mailto:/, ""))}</a></p>`
    : `<p>The publisher has not listed a contact address in this page.</p>`;
  const body = preset.request_required
    ? `<p><strong>A license request is required before any use.</strong> There is no automated endpoint yet; signed <code>OPEN</code> envelopes cannot be submitted here. Contact the publisher and reference the item and license type from the manifest.</p>`
    : `<p><strong>No license request is required</strong> if you comply with the terms at <a href="${esc(termsUrl)}">${esc(termsUrl)}</a>. There is no automated endpoint yet; signed <code>OPEN</code> envelopes cannot be submitted here.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(publisher)} — license requests</title>
<style>
  body { margin: 0; padding: 48px 24px; font-family: ui-monospace, Menlo, monospace; background: #0b0b0b; color: #e8e3d5; line-height: 1.6; }
  main { max-width: 720px; margin: 0 auto; }
  a { color: inherit; }
  code { border: 1px solid rgba(232,227,213,.2); padding: 1px 5px; border-radius: 4px; }
  .muted { color: #8a8678; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>License requests</h1>
  <p>This URL is the <code>request_endpoint</code> declared in the signed ProofMeta manifest at <a href="${esc(origin)}/.well-known/proofmeta.json">${esc(origin)}/.well-known/proofmeta.json</a>.</p>
  ${body}
  ${contactLine}
  <p class="muted">When an automated endpoint ships, it will accept signed <code>OPEN</code> envelopes at this URL and the manifest will be re-issued. Protocol: <a href="https://github.com/bettabeta/proofmeta">ProofMeta</a>, Apache-2.0.</p>
</main>
</body>
</html>
`;
}

/** Hosting notes shipped next to the generated files. */
export function hostingReadme({ origin, licenseId, keyFile }) {
  return `ProofMeta policy for ${origin}
==============================

Upload these files to your site, keeping the paths:

  .well-known/proofmeta.json                      signed manifest (the policy)
  .well-known/proofmeta-terms/${licenseId}.txt    the terms text the manifest hashes
  requests.html                                   the page agents are sent to for requests

Serve proofmeta.json as Content-Type: application/json, UTF-8, no byte-order mark.
Do not edit proofmeta.json or the terms text by hand after signing; the hashes
would no longer match. Re-run the generator or \`proofmeta init\` instead.

Recommended: allow cross-origin reads of /.well-known/proofmeta.json so browser
tools such as https://www.proofmeta.com/verify can fetch it.

  nginx
    location = /.well-known/proofmeta.json {
      default_type application/json;
      add_header Access-Control-Allow-Origin "*";
    }

  Apache (.htaccess)
    <Files "proofmeta.json">
      Header set Access-Control-Allow-Origin "*"
    </Files>

  Vercel (vercel.json -> "headers")
    { "source": "/.well-known/proofmeta.json",
      "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }] }

  Netlify / Cloudflare Pages (_headers)
    /.well-known/proofmeta.json
      Access-Control-Allow-Origin: *

  GitHub Pages
    Commit the files as-is. Add an empty .nojekyll file at the site root so the
    .well-known directory is published.

  WordPress and other managed hosts
    Upload via SFTP or the host's file manager into the web root. Some hosts hide
    directories that start with a dot; create it from the file manager if needed.

Check the result:

  https://www.proofmeta.com/verify?url=${origin}/.well-known/proofmeta.json
  npx @proofmeta/cli fetch ${origin}
${keyFile ? `
Your signing key is in ${keyFile}. Keep it private and back it up: it is the
only way to re-issue this policy under the same identity (did:key).
` : ""}`;
}
