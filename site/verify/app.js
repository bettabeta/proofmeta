(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CORE_SCOPES = new Set(["commercial","non-commercial","derivative-allowed","attribution-required","ai-training-allowed","ai-training-excluded","sublicense-allowed","revocable"]);

  // ── Tabs ──────────────────────────────────────────────────────────────
  let mode = "paste";
  const tabs = { paste: $("tab-paste"), url: $("tab-url"), file: $("tab-file") };
  const panes = { paste: $("in-paste"), url: $("in-url"), file: $("in-file") };
  for (const [name, el] of Object.entries(tabs)) {
    el.addEventListener("click", () => {
      mode = name;
      for (const n of Object.keys(tabs)) {
        tabs[n].classList.toggle("active", n === name);
        panes[n].classList.toggle("hidden", n !== name);
      }
    });
  }

  // ── Input acquisition ─────────────────────────────────────────────────
  async function getBytes() {
    if (mode === "paste") {
      const text = $("input-json").value;
      if (!text.trim()) throw new Error("Paste an envelope first.");
      return new TextEncoder().encode(text);
    }
    if (mode === "url") {
      const url = $("input-url").value.trim();
      if (!url) throw new Error("Enter a URL first.");
      let res;
      try { res = await fetch(url, { redirect: "follow" }); }
      catch { throw new Error("Fetch failed — most likely the server does not send an Access-Control-Allow-Origin header (CORS), or the URL is unreachable. Download the file and use the upload tab instead. Site owners: see the CORS snippets in the Generator, step 5."); }
      if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    const file = $("input-file").files[0];
    if (!file) throw new Error("Choose a file first.");
    return new Uint8Array(await file.arrayBuffer());
  }

  // ── Verify ────────────────────────────────────────────────────────────
  $("btn-verify").addEventListener("click", run);
  async function run() {
    $("verify-err").classList.add("hidden");
    $("report-panel").classList.add("hidden");
    let bytes;
    try { bytes = await getBytes(); }
    catch (e) { $("verify-err").textContent = e.message; $("verify-err").classList.remove("hidden"); return; }

    // First pass: pure integrity inspection — works for any payload type.
    const inspect = await ProofMeta.acceptProtocolInput(
      { kind: "bytes", bytes },
      { operation: "inspect-envelope", purpose: "inspection" },
    );

    // If it's a manifest, the protocol defines a full conformance verdict.
    const isManifest = inspect.snapshot && typeof inspect.snapshot === "object"
      && !Array.isArray(inspect.snapshot)
      && inspect.snapshot.payload && inspect.snapshot.payload.type === "manifest";
    const report = isManifest
      ? await ProofMeta.acceptProtocolInput({ kind: "bytes", bytes }, { operation: "manifest", purpose: "protocol-conformance" })
      : inspect;

    render(report, isManifest);
  }

  function render(report, isManifest) {
    const failed = report.errors.length > 0;
    const v = $("report-verdict");
    if (isManifest) {
      v.className = report.accepted ? "verdict pass" : "verdict fail";
      v.textContent = report.accepted
        ? "✓ VALID MANIFEST — signature, hash, schema and scope all check out"
        : "✗ REJECTED — this manifest does not verify";
    } else if (failed) {
      v.className = "verdict fail";
      v.textContent = "✗ REJECTED — this envelope does not verify";
    } else {
      v.className = "verdict info";
      v.textContent = "◆ ENVELOPE INTEGRITY OK — signature, hash and schema verified (no lifecycle context checked)";
    }

    const errUl = $("report-errors");
    errUl.innerHTML = "";
    errUl.classList.toggle("hidden", !failed);
    for (const e of report.errors) {
      const li = document.createElement("li");
      li.textContent = `${e.code} at ${e.path || "/"}` + (e.position !== undefined ? ` (position ${e.position})` : "");
      errUl.appendChild(li);
    }

    const LABELS = {
      ingress: "transport", schema: "schema", hash: "payload hash",
      signature: "signature", authority: "authority", context: "context", policy: "policy",
    };
    const SYMBOL = { pass: ["✓ pass", "s-pass"], fail: ["✗ fail", "s-fail"], "not-checked": ["— not checked", "s-skip"], "not-applicable": ["— n/a", "s-skip"] };
    const rows = Object.entries(report.checks).map(([k, s]) => {
      const [txt, cls] = SYMBOL[s];
      return `<tr><td>${LABELS[k] || k}</td><td class="${cls}">${txt}</td></tr>`;
    });
    $("report-checks").innerHTML = rows.join("");

    const meta = $("report-meta");
    meta.innerHTML = "";
    const env = report.snapshot;
    if (env && typeof env === "object" && !Array.isArray(env)) {
      const dd = (dt, val) => { if (val !== undefined) meta.innerHTML += `<dt>${dt}</dt><dd>${esc(val)}</dd>`; };
      dd("who — author", env.author);
      dd("when — signed at", env.timestamp);
      dd("what — payload type", env.payload && env.payload.type);
      dd("payload hash", env.payload_hash);
      if (env.in_reply_to) dd("in reply to", env.in_reply_to);
    }

    const m = $("report-manifest");
    m.innerHTML = "";
    if (isManifest && env && env.payload) {
      const p = env.payload;
      let html = "";
      if (p.provider) {
        html += `<dl class="meta"><dt>provider</dt><dd>${esc(p.provider.name || "")}${p.provider.name ? " — " : ""}${esc(p.provider.id || "")}</dd>`;
        html += `<dt>request endpoint</dt><dd>${esc(p.request_endpoint || "")}</dd>`;
        if (p.catalog_endpoint) html += `<dt>catalog endpoint</dt><dd>${esc(p.catalog_endpoint)}</dd>`;
        if (Array.isArray(p.items)) html += `<dt>inline items</dt><dd>${p.items.length}</dd>`;
        html += `</dl>`;
      }
      for (const lt of Array.isArray(p.license_types) ? p.license_types : []) {
        const chips = (Array.isArray(lt.scope) ? lt.scope : []).map((tag) => {
          const cls = tag === "ai-training-excluded" || tag === "non-commercial" ? "r"
            : CORE_SCOPES.has(tag) ? "g" : "u";
          return `<span class="chip ${cls}">${esc(tag)}</span>`;
        }).join("");
        html += `<div class="lic-block">
          <span class="lid">${esc(lt.id)}</span>${lt.name ? " · " + esc(lt.name) : ""}
          ${lt.price_hint ? ` · ${esc(lt.price_hint.amount)} ${esc(lt.price_hint.currency)}` : ""}<br>
          <a href="${esc(lt.terms_url)}" rel="noopener nofollow">${esc(lt.terms_url)}</a>
          <div class="chips">${chips}</div>
        </div>`;
      }
      m.innerHTML = html;
    }

    $("report-panel").classList.remove("hidden");
    $("report-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── ?url= deep link ───────────────────────────────────────────────────
  const qurl = new URLSearchParams(location.search).get("url");
  if (qurl) {
    tabs.url.click();
    $("input-url").value = qurl;
    run();
  }
})();
