/*
 * Terms Guard — content script
 * Activates on signup / checkout / subscribe pages, scans the page and the
 * linked Terms / Privacy / Refund / Cancellation pages, and shows a verdict
 * card before you commit. All rendering is in a Shadow DOM.
 */
(function () {
  "use strict";
  if (window.top !== window) return;
  const TG = window.TERMSGUARD;
  if (!TG) return;

  let settings = { enabled: true };
  let verdict = null;        // aggregated {items,count,risk,score}
  let scannedDocs = [];      // [{type,url,ok}]
  let trialDays = null;      // extracted trial length for reminder default
  let cancelUrl = null;
  let host, root, pill, card, autoOpened = false, rescanTimer;

  chrome.storage.sync.get({ enabled: true }, (s) => { settings = s; boot(); });
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) { settings.enabled = c.enabled.newValue; settings.enabled ? boot() : teardown(); }
  });

  // ---------- decision-page detection ----------
  function detectDecision() {
    let strong = 0, weak = 0;
    const url = location.href.toLowerCase();
    if (/checkout|sign-?up|signup|register|subscri|join|payment|trial|cart|order|billing/.test(url)) weak++;

    const btns = document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a.button,a.btn');
    const BTN = /\b(pay( now)?|place\s+order|complete\s+(order|purchase|checkout)|subscribe|start\s+(your\s+)?(free\s+)?trial|sign\s*up|create\s+(an\s+)?account|join\s+now|confirm\s+(order|purchase|payment)|continue\s+to\s+payment|proceed\s+to\s+(pay|checkout)|checkout|enroll|complete\s+sign)\b/i;
    let i = 0;
    for (const b of btns) {
      if (++i > 400) break;
      const t = (b.value || b.innerText || b.textContent || "").trim();
      if (t && t.length < 40 && BTN.test(t)) { strong++; break; }
    }
    if (document.querySelector('input[autocomplete*="cc-"],input[autocomplete="cc-number"],input[name*="card" i][type="text"],input[name*="cardnumber" i],input[id*="cardnumber" i]')) strong++;
    if (document.querySelector('input[type="password"]') && document.querySelector('button,input[type="submit"]')) weak++;
    const bodyText = (document.body.innerText || "").toLowerCase();
    if (/\bagree to (?:the|our) (?:terms|conditions)\b|\bby (?:clicking|continuing|signing up)\b/.test(bodyText)) weak++;

    return strong >= 1 || weak >= 2;
  }

  // ---------- gather candidate legal links ----------
  function collectLinks() {
    const out = [];
    const seen = new Set();
    let i = 0;
    for (const a of document.querySelectorAll("a[href]")) {
      if (++i > 600) break;
      let href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
      let abs; try { abs = new URL(href, location.href).href; } catch (e) { continue; }
      if (abs.length > 400) continue;
      const type = TG.classifyLink(abs, a.innerText || a.textContent || "");
      if (!type) continue;
      const key = type + "|" + abs;
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (type === "cancel" && !cancelUrl) cancelUrl = abs;
      out.push({ url: abs, type });
    }
    // prioritise the most useful doc types, cap to 4 fetches
    const order = { terms: 0, refund: 1, cancel: 2, billing: 3, privacy: 4, shipping: 5 };
    out.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    const picked = [], usedType = new Set();
    for (const l of out) { if (usedType.has(l.type)) continue; usedType.add(l.type); picked.push(l); if (picked.length >= 4) break; }
    return picked;
  }

  // ---------- main scan ----------
  async function scan() {
    if (!settings.enabled) return;
    if (!detectDecision()) { teardown(); notifyBadge("off", 0); return; }

    const pageFindings = TG.scanText(document.body.innerText || "", { type: "page", url: location.href });
    const links = collectLinks();

    let docFindings = [];
    scannedDocs = [{ type: "page", url: location.href, ok: true }];
    if (links.length) {
      try {
        const res = await chrome.runtime.sendMessage({ type: "FETCH_DOCS", urls: links });
        if (res && res.findings) {
          docFindings = res.findings;
          scannedDocs = scannedDocs.concat(res.fetched || []);
        }
      } catch (e) {}
    }

    verdict = TG.aggregate([pageFindings, docFindings]);

    // reminder defaults
    const ft = verdict.items.find((x) => x.cat === "free_trial");
    const ar = verdict.items.find((x) => x.cat === "auto_renew");
    trialDays = null;
    if (ft || ar) {
      const m = ((ft && ft.line) || (ar && ar.line) || "").match(/(\d+)[\s-]?(day|week|month)/i);
      if (m) { const n = +m[1]; trialDays = m[2].toLowerCase() === "week" ? n * 7 : m[2].toLowerCase() === "month" ? n * 30 : n; }
      else trialDays = 7;
    }

    render();
    notifyBadge(verdict.count ? verdict.risk : "clear", verdict.count);
  }

  function notifyBadge(risk, count) {
    chrome.runtime.sendMessage({ type: "REPORT", risk, count }).catch(() => {});
  }

  function observe() {
    if (mo) return;
    mo = new MutationObserver(() => { clearTimeout(rescanTimer); rescanTimer = setTimeout(scan, 1400); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  let booted = false, mo = null;
  function boot() { if (!settings.enabled || booted) return; booted = true; scan(); observe(); }
  function teardown() {
    if (mo) { mo.disconnect(); mo = null; }
    clearTimeout(rescanTimer);
    if (host) host.remove();
    host = pill = card = null;
    autoOpened = false;
    booted = false; // allow a clean restart if the user re-enables
  }

  // ---------- UI ----------
  function buildHost() {
    host = document.createElement("div");
    host.id = "termsguard-root";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:18px;right:18px;";
    root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style"); st.textContent = CSS; root.appendChild(st);
    document.documentElement.appendChild(host);
  }

  function render() {
    if (!verdict) return;
    if (!host) buildHost();
    const risk = verdict.count ? verdict.risk : "clear";
    if (!pill) { pill = document.createElement("button"); pill.className = "tg-pill"; pill.addEventListener("click", toggleCard); root.appendChild(pill); }
    pill.dataset.risk = risk;
    pill.innerHTML = `${shieldSvg()}<span class="tg-pill-t">${verdict.count ? verdict.count + " to check" : "Looks clear"}</span>`;
    if (verdict.count >= 1 && !autoOpened) { autoOpened = true; openCard(); }
    if (card && card.classList.contains("open")) renderCard();
  }

  function toggleCard() { if (!card) { card = document.createElement("div"); card.className = "tg-card"; root.appendChild(card); } card.classList.toggle("open") && renderCard(); }
  function openCard() { if (!card) { card = document.createElement("div"); card.className = "tg-card"; root.appendChild(card); } if (!card.classList.contains("open")) { card.classList.add("open"); renderCard(); } }

  function renderCard() {
    const risk = verdict.count ? verdict.risk : "clear";
    const RISK_TXT = { clear: "Looks clear", watch: "Worth a look", high: "Read before you commit" };
    const header = `
      <div class="tg-head" data-risk="${risk}">
        <div>
          <div class="tg-h-title">${verdict.count ? `${verdict.count} thing${verdict.count === 1 ? "" : "s"} to check` : "Nothing flagged"}</div>
          <div class="tg-h-sub">${RISK_TXT[risk]} \u00B7 before you ${ctaWord()}</div>
        </div>
        <button class="tg-x" title="Close">\u2715</button>
      </div>`;

    let body = "";
    if (verdict.count === 0) {
      body = `<div class="tg-empty">${shieldSvg(34)}<p>No gotchas found here.</p><span>We checked this page and its terms and didn't spot auto-renewal, refund limits, arbitration, or hidden fees.</span></div>`;
    } else {
      body = '<div class="tg-list">';
      verdict.items.forEach((it, idx) => {
        const m = TG.CATEGORY_META[it.cat];
        const where = [...new Set(it.sources.map((s) => TG.SOURCE_LABEL[s.type] || "linked page"))].join(", ");
        body += `
          <div class="tg-item tg-${it.sev}">
            <span class="tg-ic">${m.icon}</span>
            <div class="tg-item-b">
              <div class="tg-line">${esc(it.line)}</div>
              <div class="tg-meta"><span class="tg-where">from ${esc(where)}</span>${it.snippet ? `<button class="tg-evi" data-i="${idx}">show where</button>` : ""}</div>
              ${it.snippet ? `<div class="tg-snip" id="snip-${idx}">\u201C${esc(it.snippet)}\u201D</div>` : ""}
            </div>
          </div>`;
      });
      body += "</div>";
    }

    const remind = trialDays != null ? `
      <div class="tg-remind">
        <div class="tg-remind-row">
          <span>\uD83D\uDD14 Remind me to cancel in</span>
          <input type="number" min="1" max="365" value="${trialDays}" id="tg-days"/>
          <span>days</span>
          <button id="tg-setrem" class="tg-btn-sm">Set</button>
        </div>
        <div class="tg-remind-msg" id="tg-rem-msg"></div>
      </div>` : "";

    const docs = scannedDocs.length
      ? `<div class="tg-foot">Scanned: ${scannedDocs.map((d) => esc(TG.SOURCE_LABEL[d.type] || "page")).join(" \u00B7 ")}<span class="tg-brand">Terms Guard \u00B7 100% local</span></div>`
      : "";

    card.innerHTML = header + body + remind + docs;
    card.querySelector(".tg-x").addEventListener("click", toggleCard);
    card.querySelectorAll(".tg-evi").forEach((b) => b.addEventListener("click", () => {
      const s = card.querySelector("#snip-" + b.dataset.i); if (s) s.classList.toggle("open");
    }));
    const setBtn = card.querySelector("#tg-setrem");
    if (setBtn) setBtn.addEventListener("click", setReminder);
  }

  async function setReminder() {
    const days = Math.max(1, Math.min(365, parseInt(card.querySelector("#tg-days").value, 10) || trialDays || 7));
    const renewAt = Date.now() + days * 86400000;
    const msg = card.querySelector("#tg-rem-msg");
    try {
      await chrome.runtime.sendMessage({
        type: "SET_REMINDER",
        record: {
          site: location.hostname.replace(/^www\./, ""),
          signupUrl: location.href,
          cancelUrl: cancelUrl || location.href,
          days, renewAt,
          createdAt: Date.now(),
        },
      });
      if (msg) msg.textContent = `\u2713 We'll remind you a day before \u2014 ${new Date(renewAt).toLocaleDateString()}`;
    } catch (e) { if (msg) msg.textContent = "Couldn't set the reminder."; }
  }

  function ctaWord() {
    const t = (document.title + " " + location.href).toLowerCase();
    if (/trial/.test(t)) return "start the trial";
    if (/subscri/.test(t)) return "subscribe";
    if (/checkout|cart|order|pay/.test(t)) return "pay";
    return "sign up";
  }

  // ---------- popup messaging ----------
  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m.type === "GET_REPORT") {
      send(verdict ? { ok: true, active: !!host, enabled: settings.enabled, verdict, scannedDocs, meta: TG.CATEGORY_META, sourceLabel: TG.SOURCE_LABEL } : { ok: true, active: false, enabled: settings.enabled });
    } else if (m.type === "RESCAN") { scan(); send({ ok: true }); }
    else if (m.type === "OPEN_CARD") { if (host) openCard(); send({ ok: true }); }
    return true;
  });

  // ---------- utils ----------
  function esc(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function shieldSvg(sz = 17) {
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>`;
  }

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
  .tg-pill{display:flex;align-items:center;gap:8px;border:none;cursor:pointer;
    background:#0f2a24;color:#eafff6;padding:9px 14px 9px 11px;border-radius:999px;font-size:13px;line-height:1;
    box-shadow:0 6px 24px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.06);transition:transform .15s}
  .tg-pill:hover{transform:translateY(-2px)}
  .tg-pill[data-risk="clear"]{background:#0f2a24;color:#9af0c8}
  .tg-pill[data-risk="watch"]{background:#3a2e08;color:#ffd76b}
  .tg-pill[data-risk="high"]{background:#3a160f;color:#ffb3a3}
  .tg-pill svg{flex:0 0 auto}
  .tg-card{position:absolute;bottom:52px;right:0;width:372px;max-height:74vh;display:none;flex-direction:column;
    background:#fcfaf6;color:#1a1c22;border-radius:16px;overflow:hidden;
    box-shadow:0 20px 64px rgba(0,0,0,.34),0 0 0 1px rgba(0,0,0,.07)}
  .tg-card.open{display:flex}
  .tg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:15px 16px;color:#fff}
  .tg-head[data-risk="clear"]{background:#16412c}
  .tg-head[data-risk="watch"]{background:#6b4e08}
  .tg-head[data-risk="high"]{background:#5c1f15}
  .tg-h-title{font-size:17px;font-weight:800;letter-spacing:.2px}
  .tg-h-sub{font-size:12px;opacity:.82;margin-top:3px}
  .tg-x{background:transparent;border:none;color:#fff;opacity:.6;font-size:15px;cursor:pointer}
  .tg-x:hover{opacity:1}
  .tg-list{overflow-y:auto;padding:4px 0}
  .tg-item{display:flex;gap:11px;padding:11px 16px;border-bottom:1px solid #f1ece1;align-items:flex-start}
  .tg-item:last-child{border-bottom:none}
  .tg-ic{font-size:17px;line-height:1.2;flex:0 0 auto}
  .tg-item-b{flex:1;min-width:0}
  .tg-line{font-size:13.5px;font-weight:600;line-height:1.35;color:#20222a}
  .tg-high .tg-line{color:#9e2414}
  .tg-meta{display:flex;align-items:center;gap:10px;margin-top:4px}
  .tg-where{font-size:11px;color:#8a8d94}
  .tg-evi{background:none;border:none;color:#1f6f53;font-size:11px;cursor:pointer;padding:0;text-decoration:underline}
  .tg-snip{display:none;margin-top:6px;font-size:11.5px;font-style:italic;color:#6a6d74;
    background:#f4efe4;border-left:2px solid #cdc6b6;padding:6px 8px;border-radius:0 6px 6px 0;line-height:1.4}
  .tg-snip.open{display:block}
  .tg-empty{padding:30px 22px;text-align:center;color:#16412c}
  .tg-empty p{font-weight:700;margin:10px 0 5px;font-size:15px}
  .tg-empty span{font-size:12px;color:#7a7d84;line-height:1.45;display:block}
  .tg-remind{border-top:1px solid #ece6d8;background:#f6f1e6;padding:11px 16px}
  .tg-remind-row{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#3a3d44;flex-wrap:wrap}
  #tg-days{width:52px;border:1px solid #d6cfbf;border-radius:6px;padding:4px 6px;font-size:13px;text-align:center}
  .tg-btn-sm{margin-left:auto;background:#0f2a24;color:#fff;border:none;border-radius:7px;padding:5px 13px;font-size:12px;font-weight:600;cursor:pointer}
  .tg-btn-sm:hover{background:#000}
  .tg-remind-msg{font-size:11.5px;color:#1f6f53;margin-top:7px;min-height:1px}
  .tg-foot{padding:10px 16px;border-top:1px solid #ece6d8;background:#f2ece0;font-size:10.5px;color:#9a948a;
    display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .tg-brand{color:#bdb6a8}
  `;
})();
