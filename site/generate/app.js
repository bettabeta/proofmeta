(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SCOPES = [
    ["commercial", "commercial use allowed"],
    ["non-commercial", "non-commercial only"],
    ["derivative-allowed", "derivatives allowed"],
    ["attribution-required", "attribution required"],
    ["ai-training-allowed", "AI training allowed"],
    ["ai-training-excluded", "AI training excluded"],
    ["sublicense-allowed", "sublicensing allowed"],
    ["revocable", "provider may revoke"],
  ];
  const EXCLUSIVE = { "commercial": "non-commercial", "non-commercial": "commercial",
    "ai-training-allowed": "ai-training-excluded", "ai-training-excluded": "ai-training-allowed" };

  let keyPair = null;

  // ── Mode switch ───────────────────────────────────────────────────────
  function setMode(mode) {
    const simple = mode === "simple";
    $("mode-simple").classList.toggle("hidden", !simple);
    $("mode-advanced").classList.toggle("hidden", simple);
    $("mode-simple-btn").setAttribute("aria-pressed", String(simple));
    $("mode-advanced-btn").setAttribute("aria-pressed", String(!simple));
    if (location.hash !== (simple ? "" : "#advanced")) history.replaceState(null, "", simple ? location.pathname : "#advanced");
  }
  $("mode-simple-btn").addEventListener("click", () => setMode("simple"));
  $("mode-advanced-btn").addEventListener("click", () => setMode("advanced"));
  setMode(location.hash === "#advanced" ? "advanced" : "simple");

  // ── Simple mode ───────────────────────────────────────────────────────
  const { PRESETS, termsText, requestsHtml, hostingReadme } = ProofMetaPresets;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let simpleKey = null;      // imported key, or null → generate on create
  let simpleOut = null;      // { files: Map, origin, keyPair }

  function renderPresets() {
    const list = $("preset-list");
    list.innerHTML = PRESETS.map((p, i) => `
      <label class="preset${i === 1 ? " selected" : ""}">
        <input type="radio" name="preset" value="${p.id}"${i === 1 ? " checked" : ""}>
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-summary">${esc(p.summary)}</div>
        <div class="p-tags">${p.scope.map((t) => `<span class="${t.endsWith("-excluded") || t === "non-commercial" || t === "revocable" ? "no" : "yes"}">${t}</span>`).join("")}</div>
      </label>`).join("");
    list.querySelectorAll("input").forEach((r) => r.addEventListener("change", () => {
      list.querySelectorAll(".preset").forEach((l) => l.classList.toggle("selected", l.querySelector("input").checked));
    }));
  }
  renderPresets();

  function simpleError(msg) {
    $("s-err").textContent = msg;
    $("s-err").classList.remove("hidden");
    $("s-result").classList.add("hidden");
  }

  $("s-havekey").addEventListener("change", () => {
    $("s-keyimport").classList.toggle("hidden", !$("s-havekey").checked);
    if (!$("s-havekey").checked) { simpleKey = null; $("s-keyloaded").classList.add("hidden"); }
  });
  $("s-keyfile").addEventListener("change", async () => {
    const file = $("s-keyfile").files[0];
    if (!file) return;
    try {
      simpleKey = await loadKeyFile(await file.text(), () => $("s-pass").value);
      $("s-keydid").textContent = simpleKey.did;
      $("s-keyloaded").classList.remove("hidden");
      $("s-err").classList.add("hidden");
    } catch (e) {
      simpleKey = null;
      $("s-keyloaded").classList.add("hidden");
      simpleError("Key backup: " + e.message + (ProofMetaKeyFile.isEncrypted(safeJson(await file.text())) ? " — enter the passphrase in step 3 first, then choose the file again." : ""));
    }
  });
  function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
  async function loadKeyFile(text, getPassphrase) {
    const value = safeJson(text);
    if (!value) throw new Error("not a JSON file");
    const priv = await ProofMetaKeyFile.privateKeyFrom(value, async () => getPassphrase());
    const kp = await ProofMeta.keyPairFromPrivate(priv);
    if (typeof value.did === "string" && value.did !== kp.did) throw new Error("file DID does not match its private key");
    return kp;
  }

  function normalizeOrigin(input) {
    if (!String(input).trim()) throw new Error("Step 1: enter your site address (the field is empty; the grey text is only an example).");
    let url;
    try { url = new URL(String(input).trim()); } catch { throw new Error("Your site must be a full address such as https://example.com"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Your site must start with https://");
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Enter only the site address, without a path (https://example.com, not https://example.com/blog)");
    return url.origin;
  }
  function normalizeContact(input) {
    const raw = String(input || "").trim();
    if (!raw) return undefined;
    const candidate = /^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(raw) ? "mailto:" + raw : raw;
    let url;
    try { url = new URL(candidate); } catch { throw new Error("Contact must be an email address or a full URL"); }
    if (!["mailto:", "https:", "http:"].includes(url.protocol)) throw new Error("Contact must be an email address or an https:// URL");
    return url.href;
  }

  $("s-create").addEventListener("click", async () => {
    $("s-err").classList.add("hidden");
    try {
      const publisher = $("s-name").value.trim();
      if (!publisher) throw new Error("Step 1: your name or organisation is required.");
      const origin = normalizeOrigin($("s-origin").value);
      const contact = normalizeContact($("s-contact").value);
      const preset = PRESETS.find((p) => p.id === document.querySelector('input[name="preset"]:checked')?.value);
      if (!preset) throw new Error("Step 2: choose a policy.");
      const pass = $("s-pass").value;
      if (pass && pass.length < 8) throw new Error("Step 3: the passphrase needs at least 8 characters, or leave it empty.");
      if ($("s-havekey").checked && !simpleKey) throw new Error("Step 3: choose your key backup file, or untick the box to create a new key.");
      const kp = simpleKey || await ProofMeta.generateKeyPair();

      const date = new Date().toISOString().slice(0, 10);
      const licenseId = preset.id;
      const termsPath = `.well-known/proofmeta-terms/${licenseId}.txt`;
      const terms = termsText({ preset, publisher, origin, date });
      const termsUrl = `${origin}/${termsPath}`;
      const payload = {
        type: "manifest",
        provider: { id: kp.did, name: publisher },
        request_endpoint: `${origin}/requests.html`,
        items: [{ item_id: "site-content", name: `Content published at ${origin}`, description: `Everything ${publisher} publishes at ${origin}, unless an item states otherwise.`, available_licenses: [licenseId] }],
        license_types: [{ id: licenseId, name: preset.name, terms_url: termsUrl, terms_hash: ProofMeta.sha256Ref(new TextEncoder().encode(terms)), scope: [...preset.scope] }],
      };
      const envelope = await ProofMeta.createEnvelope({ payload, author: kp.did, privateKey: kp.privateKey });
      const manifestJson = JSON.stringify(envelope, null, 2) + "\n";
      const report = await ProofMeta.acceptProtocolInput(
        { kind: "bytes", bytes: new TextEncoder().encode(manifestJson) },
        { operation: "manifest", purpose: "protocol-conformance" },
      );
      const v = $("s-verdict");
      if (!report.accepted) {
        v.className = "verdict fail";
        v.textContent = "✗ self-check failed: " + report.errors.map((e) => `${e.code} at ${e.path || "/"}`).join("; ");
        $("s-result").classList.remove("hidden");
        $("s-files").innerHTML = "";
        simpleOut = null;
        return;
      }
      v.className = "verdict pass";
      v.textContent = "✓ self-check passed — signed, hashed, schema-valid, scope-valid";

      const files = new Map([
        [".well-known/proofmeta.json", manifestJson],
        [termsPath, terms],
        ["requests.html", requestsHtml({ publisher, origin, preset, contact, termsUrl })],
        ["README.txt", hostingReadme({ origin, licenseId, keyFile: "proofmeta-key.json (your backup)" })],
      ]);
      simpleOut = { files, origin, keyPair: kp, pass };
      $("s-did").textContent = kp.did;
      const what = { ".well-known/proofmeta.json": "the signed policy — upload", [termsPath]: "terms text the policy hashes — upload (edit first if you like, then re-create)", "requests.html": "where agents are sent to ask — upload", "README.txt": "hosting notes — keep" };
      $("s-files").innerHTML = [...files.keys()].map((name) => `<li><code>${esc(name)}</code><span class="what">${esc(what[name])}</span><button type="button" class="small" data-file="${esc(name)}">download</button></li>`).join("");
      $("s-files").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => download(b.dataset.file.split("/").pop(), files.get(b.dataset.file), b.dataset.file.endsWith(".json") ? "application/json" : b.dataset.file.endsWith(".html") ? "text/html" : "text/plain")));
      $("s-verify").href = "/verify?url=" + encodeURIComponent(`${origin}/.well-known/proofmeta.json`);
      $("s-readme").textContent = files.get("README.txt");
      $("s-keywarn").textContent = simpleKey
        ? "Signed with your imported key. Keep its backup."
        : pass
          ? "⚠ Download the key backup now. It is encrypted with your passphrase; without the file and the passphrase you cannot change this policy under the same identity."
          : "⚠ Download the key backup now and keep it private. It is NOT encrypted — set a passphrase in step 3 and create again for an encrypted backup.";
      $("s-result").classList.remove("hidden");
      $("s-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("s-pass").value = "";
    } catch (e) {
      simpleError(e.message);
    }
  });

  async function keyBackupJson(kp, pass) {
    const file = pass ? await ProofMetaKeyFile.encrypt(kp, pass) : ProofMetaKeyFile.plain(kp);
    return JSON.stringify(file, null, 2) + "\n";
  }
  $("s-keybackup").addEventListener("click", async () => {
    if (!simpleOut) return;
    try { download("proofmeta-key-" + simpleOut.keyPair.did.slice(-8) + ".json", await keyBackupJson(simpleOut.keyPair, simpleOut.pass)); }
    catch (e) { simpleError("Key backup failed: " + e.message); }
  });
  $("s-zip").addEventListener("click", async () => {
    if (!simpleOut) return;
    try {
      const entries = [...simpleOut.files].map(([name, data]) => ({ name, data }));
      entries.push({ name: "proofmeta-key.json", data: await keyBackupJson(simpleOut.keyPair, simpleOut.pass) });
      const host = new URL(simpleOut.origin).hostname;
      download(`proofmeta-${host}.zip`, ProofMetaZip.build(entries), "application/zip");
    } catch (e) { simpleError("Zip failed: " + e.message); }
  });

  // ── Identity ──────────────────────────────────────────────────────────
  function showKey() {
    $("did-value").textContent = keyPair.did;
    $("key-info").classList.remove("hidden");
    $("key-err").classList.add("hidden");
    $("import-box").classList.add("hidden");
  }
  function keyError(msg) {
    $("key-err").textContent = msg;
    $("key-err").classList.remove("hidden");
  }
  $("btn-genkey").addEventListener("click", async () => {
    try { keyPair = await ProofMeta.generateKeyPair(); showKey(); }
    catch (e) { keyError("Key generation failed: " + e.message + " (a secure context — https or localhost — is required)"); }
  });
  $("btn-togimport").addEventListener("click", () => $("import-box").classList.toggle("hidden"));
  $("btn-import").addEventListener("click", async () => {
    const hex = $("import-seed").value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return keyError("Seed must be exactly 64 hex characters.");
    try { keyPair = await ProofMeta.keyPairFromPrivate(ProofMeta.hexToBytes(hex)); $("import-seed").value = ""; showKey(); }
    catch (e) { keyError("Import failed: " + e.message); }
  });
  $("import-file").addEventListener("change", async () => {
    const file = $("import-file").files[0];
    if (!file) return;
    try { keyPair = await loadKeyFile(await file.text(), () => $("import-pass").value); $("import-pass").value = ""; showKey(); }
    catch (e) { keyError("Import failed: " + e.message); }
    $("import-file").value = "";
  });
  $("btn-downloadkey").addEventListener("click", async () => {
    const pass = $("backup-pass").value;
    if (pass && pass.length < 8) return keyError("Backup passphrase needs at least 8 characters, or leave it empty for a plaintext backup.");
    try {
      download("proofmeta-key-" + keyPair.did.slice(-8) + ".json", await keyBackupJson(keyPair, pass));
      $("backup-pass").value = "";
      $("key-err").classList.add("hidden");
    } catch (e) { keyError("Backup failed: " + e.message); }
  });
  $("btn-copydid").addEventListener("click", () => navigator.clipboard.writeText(keyPair.did));

  // ── License types ─────────────────────────────────────────────────────
  let licSeq = 0;
  function addLicense() {
    const n = ++licSeq;
    const fs = document.createElement("fieldset");
    fs.className = "card lic";
    fs.innerHTML = `
      <legend>license type</legend>
      <button class="remove small danger" type="button">remove</button>
      <div class="row">
        <div><label>ID <span class="req">*</span></label><input type="text" class="l-id" placeholder="standard-commercial"></div>
        <div><label>Name</label><input type="text" class="l-name" placeholder="Standard Commercial"></div>
      </div>
      <label>Terms URL <span class="req">*</span></label>
      <input type="url" class="l-terms-url" placeholder="https://example.com/licenses/standard.txt">
      <label>Terms hash (sha256 of the license text) <span class="req">*</span></label>
      <input type="text" class="l-terms-hash" spellcheck="false" placeholder="sha256:…  — or compute it below">
      <details class="helper">
        <summary>Compute hash from pasted license text</summary>
        <textarea class="l-terms-text" rows="4" placeholder="Paste the exact license text served at the Terms URL…"></textarea>
        <div class="row" style="margin-top:8px"><button type="button" class="small l-hashbtn fixed">Compute sha256</button></div>
      </details>
      <label>Scope <span class="req">*</span> — what this license permits / requires</label>
      <div class="scopes">
        ${SCOPES.map(([tag, desc]) =>
          `<label><input type="checkbox" class="l-scope" value="${tag}"> ${tag} <span class="desc">· ${desc}</span></label>`).join("")}
      </div>
      <label>Scope extensions (full URLs, one per line — optional)</label>
      <textarea class="l-scope-ext" rows="2" placeholder="https://example.com/scope/eu-only"></textarea>
      <div class="row">
        <div><label>Price hint — amount (optional)</label><input type="text" class="l-price" placeholder="49.00"></div>
        <div><label>Currency</label><input type="text" class="l-currency" placeholder="EUR"></div>
      </div>`;
    fs.querySelector(".remove").addEventListener("click", () => fs.remove());
    fs.querySelector(".l-hashbtn").addEventListener("click", () => {
      const text = fs.querySelector(".l-terms-text").value;
      if (!text) return;
      fs.querySelector(".l-terms-hash").value = ProofMeta.sha256Ref(new TextEncoder().encode(text));
    });
    fs.querySelectorAll(".l-scope").forEach((cb) => cb.addEventListener("change", () => {
      const other = EXCLUSIVE[cb.value];
      if (cb.checked && other) {
        const sibling = [...fs.querySelectorAll(".l-scope")].find((x) => x.value === other);
        if (sibling) sibling.checked = false;
      }
    }));
    $("license-list").appendChild(fs);
    if (!fs.querySelector(".l-id").value) fs.querySelector(".l-id").focus();
  }
  $("btn-addlicense").addEventListener("click", addLicense);
  addLicense();

  // ── Items ─────────────────────────────────────────────────────────────
  function addItem() {
    const fs = document.createElement("fieldset");
    fs.className = "card item";
    fs.innerHTML = `
      <legend>item</legend>
      <button class="remove small danger" type="button">remove</button>
      <div class="row">
        <div><label>Item ID <span class="req">*</span></label><input type="text" class="i-id" placeholder="article-archive"></div>
        <div><label>Name <span class="req">*</span></label><input type="text" class="i-name" placeholder="Full article archive"></div>
      </div>
      <label>Description</label>
      <input type="text" class="i-desc" placeholder="All published articles, updated daily.">
      <label>Available licenses <span class="req">*</span> — comma-separated license type IDs from step 3</label>
      <input type="text" class="i-lic" placeholder="standard-commercial">
      <label>Content hash (optional, sha256 of the item's canonical bytes)</label>
      <input type="text" class="i-hash" spellcheck="false" placeholder="sha256:…">`;
    fs.querySelector(".remove").addEventListener("click", () => fs.remove());
    $("item-list").appendChild(fs);
  }
  $("btn-additem").addEventListener("click", addItem);
  addItem();

  document.querySelectorAll('input[name="catmode"]').forEach((r) => r.addEventListener("change", () => {
    const items = document.querySelector('input[name="catmode"]:checked').value === "items";
    $("cat-items").classList.toggle("hidden", !items);
    $("cat-endpoint").classList.toggle("hidden", items);
  }));

  // ── Generate ──────────────────────────────────────────────────────────
  function fail(msg) {
    $("gen-err").textContent = msg;
    $("gen-err").classList.remove("hidden");
    $("result").classList.add("hidden");
    return null;
  }
  function buildPayload() {
    if (!keyPair) return fail("Step 1: generate or import a signing key first.");
    const endpoint = $("p-endpoint").value.trim();
    if (!endpoint) return fail("Step 2: the request endpoint is required.");

    const license_types = [];
    for (const fs of document.querySelectorAll("fieldset.lic")) {
      const id = fs.querySelector(".l-id").value.trim();
      const terms_url = fs.querySelector(".l-terms-url").value.trim();
      const terms_hash = fs.querySelector(".l-terms-hash").value.trim();
      const core = [...fs.querySelectorAll(".l-scope:checked")].map((x) => x.value);
      const ext = fs.querySelector(".l-scope-ext").value.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!id) return fail("Step 3: every license type needs an ID.");
      if (!terms_url) return fail(`Step 3 (${id}): terms URL is required.`);
      if (!/^sha256:[a-f0-9]{64}$/.test(terms_hash)) return fail(`Step 3 (${id}): terms hash must be "sha256:" + 64 hex chars. Use the compute helper.`);
      if (core.length === 0) return fail(`Step 3 (${id}): pick at least one core scope tag.`);
      for (const u of ext) if (!/^https?:\/\//.test(u)) return fail(`Step 3 (${id}): scope extensions must be URLs ("${u}" is not).`);
      const lt = { id, terms_url, terms_hash, scope: [...core, ...ext] };
      const name = fs.querySelector(".l-name").value.trim();
      if (name) lt.name = name;
      const amount = fs.querySelector(".l-price").value.trim();
      const currency = fs.querySelector(".l-currency").value.trim();
      if (amount || currency) {
        if (!amount || !currency) return fail(`Step 3 (${id}): a price hint needs both amount and currency.`);
        lt.price_hint = { amount, currency };
      }
      license_types.push(lt);
    }
    if (license_types.length === 0) return fail("Step 3: add at least one license type.");
    const ids = new Set(license_types.map((l) => l.id));
    if (ids.size !== license_types.length) return fail("Step 3: license type IDs must be unique.");

    const provider = { id: keyPair.did };
    const pname = $("p-name").value.trim();
    const pdesc = $("p-desc").value.trim();
    if (pname) provider.name = pname;
    if (pdesc) provider.description = pdesc;

    const payload = { type: "manifest", provider, request_endpoint: endpoint, license_types };

    if (document.querySelector('input[name="catmode"]:checked').value === "endpoint") {
      const c = $("c-endpoint").value.trim();
      if (!c) return fail("Step 4: the catalog endpoint URL is required.");
      payload.catalog_endpoint = c;
    } else {
      const items = [];
      for (const fs of document.querySelectorAll("fieldset.item")) {
        const item_id = fs.querySelector(".i-id").value.trim();
        const name = fs.querySelector(".i-name").value.trim();
        const lic = fs.querySelector(".i-lic").value.split(",").map((s) => s.trim()).filter(Boolean);
        if (!item_id || !name) return fail("Step 4: every item needs an ID and a name.");
        if (lic.length === 0) return fail(`Step 4 (${item_id}): list at least one license type ID.`);
        for (const l of lic) if (!ids.has(l)) return fail(`Step 4 (${item_id}): license "${l}" is not defined in step 3.`);
        const item = { item_id, name, available_licenses: lic };
        const desc = fs.querySelector(".i-desc").value.trim();
        if (desc) item.description = desc;
        const hash = fs.querySelector(".i-hash").value.trim();
        if (hash) {
          if (!/^sha256:[a-f0-9]{64}$/.test(hash)) return fail(`Step 4 (${item_id}): content hash must be "sha256:" + 64 hex chars.`);
          item.content_hash = hash;
        }
        items.push(item);
      }
      if (items.length === 0) return fail("Step 4: add at least one item (or switch to a catalog endpoint).");
      payload.items = items;
    }
    return payload;
  }

  let currentJson = "";
  $("btn-generate").addEventListener("click", async () => {
    $("gen-err").classList.add("hidden");
    const payload = buildPayload();
    if (!payload) return;
    try {
      const envelope = await ProofMeta.createEnvelope({
        payload, author: keyPair.did, privateKey: keyPair.privateKey,
      });
      currentJson = JSON.stringify(envelope, null, 2);
      const report = await ProofMeta.acceptProtocolInput(
        { kind: "bytes", bytes: new TextEncoder().encode(currentJson) },
        { operation: "manifest", purpose: "protocol-conformance" },
      );
      const v = $("verdict");
      if (report.accepted) {
        v.className = "verdict pass";
        v.textContent = "✓ self-check passed — signed, hashed, schema-valid, scope-valid";
      } else {
        v.className = "verdict fail";
        v.textContent = "✗ self-check failed: " + report.errors.map((e) => `${e.code} at ${e.path || "/"}`).join("; ");
      }
      $("output-json").textContent = currentJson;
      $("result").classList.remove("hidden");
      $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      fail("Signing failed: " + e.message);
    }
  });
  $("btn-download").addEventListener("click", () => download("proofmeta.json", currentJson));
  $("btn-copy").addEventListener("click", () => navigator.clipboard.writeText(currentJson));

  function download(filename, data, type = "application/json") {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
})();
