/*
 * Terms Guard — risk engine
 * Pure string analysis. Works in both the content script (window) and the
 * service worker (importScripts). Exposed as globalThis.TERMSGUARD.
 * Nothing here touches the network.
 */
(function (g) {
  "use strict";

  const SEV_RANK = { high: 3, medium: 2, low: 1 };

  const CATEGORY_META = {
    auto_renew:       { icon: "\uD83D\uDD01", label: "Auto-renewal",        def: "Renews automatically until you cancel" },
    free_trial:       { icon: "\uD83C\uDFAB", label: "Free trial",          def: "A free trial that converts to a paid plan" },
    cancel_difficulty:{ icon: "\uD83D\uDEAA", label: "Hard to cancel",      def: "Cancelling isn't one-click \u2014 they may make you contact them" },
    refund_limits:    { icon: "\u21A9\uFE0F", label: "Refund limits",       def: "Refunds are limited or not offered" },
    arbitration:      { icon: "\u2696\uFE0F", label: "Legal waiver",        def: "You may waive your right to sue or join a class action" },
    price_increase:   { icon: "\uD83D\uDCC8", label: "Price jump",          def: "The price rises after the intro period" },
    data_sharing:     { icon: "\uD83D\uDD13", label: "Data sharing",        def: "Your personal data may be shared or sold" },
    min_commitment:   { icon: "\uD83D\uDCC6", label: "Lock-in",             def: "Minimum commitment or early-termination fee" },
    hidden_fees:      { icon: "\uD83D\uDCB8", label: "Extra fees",          def: "Extra fees may apply (restocking, handling, etc.)" },
    shipping_terms:   { icon: "\uD83D\uDCE6", label: "Return conditions",   def: "Final-sale or return-shipping conditions" },
  };

  // Each rule: {cat, sev, re, detail?(match, sentence) -> string|null}
  const RULES = [
    // ---- auto renewal ----
    { cat: "auto_renew", sev: "high",
      re: /\b(auto(?:matically)?[\s-]?renew(?:s|al|ing)?|renews?\s+(?:automatically|every|each)|automatic\s+renewal|recurring\s+(?:billing|charge|payment|subscription)|charged\s+(?:again\s+)?(?:each|every)\s+(?:month|year|week|billing)|(?:each|every)\s+billing\s+(?:period|cycle)|continues?\s+until\s+(?:you\s+)?cancel|until\s+(?:you\s+)?cancel(?:l?ed)?|unless\s+(?:you\s+)?cancel(?:l?ed)?)\b/i,
      detail: (_m, s) => {
        const t = s.match(/after\s+(?:a\s+|the\s+)?(\d+)[\s-]?(day|week|month|year)/i) || s.match(/(\d+)[\s-]?(day|week|month|year)s?\s+(?:free\s+)?trial/i);
        return t ? `Auto-renews after the ${t[1]}-${t[2]} period` : null;
      } },
    // ---- free trial ----
    { cat: "free_trial", sev: "medium",
      re: /\bfree\s+trial\b|\btry\s+(?:it\s+)?free\b|\bstart\s+(?:your\s+)?free\b|\b\d+\s+days?\s+for\s+(?:\$?\s?0(?:\.00)?\b|free)\b|\bfree\s+for\s+\d+\s+(?:day|week|month)/i,
      detail: (_m, s) => {
        const t = s.match(/(\d+)[\s-]?(day|week|month)s?\s+free/i) || s.match(/free\s+for\s+(\d+)\s+(day|week|month)/i) || s.match(/(\d+)\s+days?\s+for\s+(?:\$?\s?0|free)/i) || s.match(/(\d+)[\s-]?(day|week|month)s?\s+trial/i);
        if (!t) return null;
        const unit = t[2] || "day";
        return `${t[1]}-${unit} free trial, then you're billed`;
      } },
    // ---- cancellation difficulty ----
    { cat: "cancel_difficulty", sev: "high",
      re: /\bcancel(?:lation|ling|led)?\b[^.]{0,70}\b(call|phone|by\s+mail|in\s+writing|written\s+notice|contact\s+(?:us|support|customer)|email\s+us|cannot\s+be\s+cancell?ed\s+online|not\s+be\s+cancell?ed\s+online|speak\s+to)\b/i,
      detail: (_m, s) => {
        if (/online/i.test(s) && /cannot|not\s+be/i.test(s)) return "Cannot cancel online \u2014 must contact them";
        if (/call|phone|speak/i.test(s)) return "Must call/phone to cancel";
        if (/email/i.test(s)) return "Must email to cancel (no one-click)";
        if (/writing|mail|written/i.test(s)) return "Must cancel in writing / by mail";
        return null;
      } },
    { cat: "cancel_difficulty", sev: "high",
      re: /\b(\d+)[\s-]?day[s]?\b[^.]{0,40}\bnotice\b[^.]{0,40}\bcancel|cancel[^.]{0,40}\b(\d+)[\s-]?day[s]?\b[^.]{0,30}\bnotice\b/i,
      detail: (m) => { const n = m[1] || m[2]; return n ? `Must give ${n} days' notice to cancel` : "Advance notice required to cancel"; } },
    // ---- refunds ----
    { cat: "refund_limits", sev: "high",
      re: /\b(no\s+refunds?|all\s+sales\s+(?:are\s+)?final|non[\s-]?refundable|not\s+eligible\s+for\s+(?:a\s+)?refund|no\s+money[\s-]?back)\b/i,
      detail: () => "No refunds / all sales final" },
    { cat: "refund_limits", sev: "medium",
      re: /\brefund[^.]{0,50}\bwithin\s+(\d+)\s*(hour|day)s?\b|\b(\d+)[\s-]?(hour|day)s?\b[^.]{0,25}\b(money[\s-]?back|refund)\b/i,
      detail: (m) => {
        const n = +(m[1] || m[3]), u = (m[2] || m[4] || "").toLowerCase();
        if (!n) return null;
        if (/hour/.test(u)) return `Short refund window: only ${n} hour${n === 1 ? "" : "s"}`;
        if (n <= 7) return `Short refund window: only ${n} day${n === 1 ? "" : "s"}`;
        return false; // a generous window (8+ days) isn't a risk — don't flag
      } },
    // ---- arbitration / class action ----
    { cat: "arbitration", sev: "high",
      re: /\b(binding\s+arbitration|agree\s+to\s+arbitrat|class[\s-]?action\s+waiver|waive[^.]{0,45}(class\s+action|jury\s+trial|right\s+to\s+sue)|resolve[^.]{0,30}arbitration|individual\s+arbitration)\b/i,
      detail: (_m, s) => /class[\s-]?action/i.test(s) ? "You'd give up the right to join a class action" : "Disputes go to binding arbitration, not court" },
    // ---- price increase after intro ----
    { cat: "price_increase", sev: "medium",
      re: /\b(then|after(?:\s+the)?(?:\s+(?:intro(?:ductory)?|promo(?:tional)?|trial|first))?)\b[^.]{0,25}\$\s?\d+(?:\.\d+)?\s*\/?\s*(?:per\s+)?(?:mo|month|yr|year|wk|week)/i,
      detail: (_m, s) => { const p = s.match(/\$\s?\d+(?:\.\d+)?\s*\/?\s*(?:per\s+)?(?:mo|month|yr|year|wk|week)/i); return p ? `Price becomes ${p[0].replace(/\s+/g, "")} after the intro period` : "Price rises after the intro period"; } },
    { cat: "price_increase", sev: "low",
      re: /\b(introductory|promotional|intro)\s+(price|rate|offer)\b|\bprice[^.]{0,25}(subject\s+to\s+change|may\s+increase|will\s+increase)\b/i,
      detail: () => "Introductory pricing \u2014 may go up later" },
    // ---- data sharing / selling ----
    { cat: "data_sharing", sev: "medium",
      re: /\b(we\s+(?:may\s+)?(?:sell|share|disclose)|(?:sell|share|disclose|provide)\b[^.]{0,30}\b(?:your\s+)?(?:personal\s+)?(?:information|data))\b/i,
      reject: (s) => /\b(do(?:es)?\s+not|don'?t|won'?t|will\s+not|never|cannot|can'?t)\b[^.]{0,25}\b(sell|share|disclose|rent|provide|trade)\b/i.test(s),
      detail: (_m, s) => /\bsell\b/i.test(s) ? "Your personal data may be sold" : "Your personal data may be shared with others" },
    { cat: "data_sharing", sev: "medium",
      re: /\bthird[\s-]?part(?:y|ies)\b[^.]{0,45}\b(share|sell|disclose|provide|access|receive)\b|\b(share|sell|disclose|provide)\b[^.]{0,30}\bthird[\s-]?part(?:y|ies)\b/i,
      reject: (s) => /\b(do(?:es)?\s+not|don'?t|won'?t|will\s+not|never|cannot|can'?t)\b[^.]{0,30}\b(sell|share|disclose|rent|provide|trade)\b/i.test(s),
      detail: () => "Data may go to third parties" },
    // ---- minimum commitment / lock-in ----
    { cat: "min_commitment", sev: "high",
      re: /\b(\d+)[\s-]?(month|year)s?\b[^.]{0,30}\b(minimum\s+)?(commitment|contract|term|agreement|plan)\b|\b(minimum\s+(?:term|commitment|purchase|order)|early\s+(?:termination|cancellation)\s+fee)\b/i,
      detail: (m, s) => {
        if (/early\s+(?:termination|cancellation)\s+fee/i.test(s)) return "Early-termination fee if you leave early";
        const n = m[1]; return n ? `${n}-${m[2]} minimum commitment` : "Minimum commitment required";
      } },
    // ---- hidden fees ----
    { cat: "hidden_fees", sev: "medium",
      re: /\b(restocking\s+fee|(?:processing|handling|service|convenience|activation|setup|cancellation)\s+fee|\+\s*(?:shipping|tax|fees)|plus\s+(?:shipping|tax|handling))\b/i,
      detail: (_m, s) => { const f = s.match(/(restocking|processing|handling|service|convenience|activation|setup|cancellation)\s+fee/i); return f ? `${f[1][0].toUpperCase() + f[1].slice(1)} fee applies` : "Extra fees apply"; } },
    // ---- shipping / final sale ----
    { cat: "shipping_terms", sev: "low",
      re: /\b(return\s+shipping[^.]{0,35}(?:your|customer|buyer)(?:'?s)?\s+(?:cost|expense|responsib)|final\s+sale|as[\s-]?is,?\s+no\s+returns?|customer\s+(?:is\s+)?responsible\s+for\s+return)\b/i,
      detail: (_m, s) => /final\s+sale/i.test(s) ? "Final sale \u2014 no returns" : "You pay return shipping" },
  ];

  function sentenceAround(text, idx, len) {
    let start = idx, end = idx + len;
    for (let i = idx; i > 0 && idx - i < 220; i--) { if (/[.!?\n]/.test(text[i - 1])) { start = i; break; } start = i; }
    for (let i = idx + len; i < text.length && i - (idx + len) < 220; i++) { if (/[.!?\n]/.test(text[i])) { end = i; break; } end = i; }
    return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 150);
  }

  // scan a blob of text; returns dedup'd findings (best per category)
  function scanText(text, source) {
    if (!text) return [];
    text = String(text);
    if (text.length > 300000) text = text.slice(0, 300000);
    const best = {};
    for (const rule of RULES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      const sentence = sentenceAround(text, m.index, m[0].length);
      if (rule.reject) { try { if (rule.reject(sentence)) continue; } catch (e) {} }
      let detail = null;
      try { detail = rule.detail ? rule.detail(m, sentence) : null; } catch (e) {}
      if (detail === false) continue; // rule examined the match and opted out
      const finding = {
        cat: rule.cat,
        sev: rule.sev,
        line: detail || CATEGORY_META[rule.cat].def,
        snippet: sentence,
        source: source || { type: "page" },
      };
      const cur = best[rule.cat];
      const moreSevere = !cur || SEV_RANK[finding.sev] > SEV_RANK[cur.sev];
      const upgradesToSpecific = cur && detail && cur.line === CATEGORY_META[rule.cat].def;
      if (moreSevere || upgradesToSpecific) best[rule.cat] = finding;
    }
    return Object.values(best);
  }

  // merge findings from several documents into one verdict
  function aggregate(findingArrays) {
    const byCat = {};
    findingArrays.flat().forEach((f) => {
      const cur = byCat[f.cat];
      if (!cur) { byCat[f.cat] = { ...f, sources: [f.source] }; return; }
      cur.sources.push(f.source);
      // prefer a specific line over the generic default
      if (cur.line === CATEGORY_META[f.cat].def && f.line !== CATEGORY_META[f.cat].def) cur.line = f.line;
      if (SEV_RANK[f.sev] > SEV_RANK[cur.sev]) cur.sev = f.sev;
      if (!cur.snippet && f.snippet) cur.snippet = f.snippet;
    });
    const items = Object.values(byCat).sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
    const count = items.length;
    let risk = "clear";
    const score = items.reduce((s, i) => s + SEV_RANK[i.sev], 0);
    if (count === 0) risk = "clear";
    else if (score >= 7 || items.some((i) => i.sev === "high")) risk = items.length >= 4 || score >= 9 ? "high" : "watch";
    else risk = "watch";
    return { items, count, risk, score };
  }

  // classify a link as a legal/policy doc worth fetching
  function classifyLink(href, text) {
    const s = ((text || "") + " " + (href || "")).toLowerCase();
    if (/\b(terms|conditions|\btos\b|user agreement|eula)\b/.test(s)) return "terms";
    if (/\bprivacy|data policy|data protection\b/.test(s)) return "privacy";
    if (/\brefund|returns?\b/.test(s)) return "refund";
    if (/\bcancel|cancellation|delete account|close account|unsubscribe\b/.test(s)) return "cancel";
    if (/\bshipping|delivery\b/.test(s)) return "shipping";
    if (/\bsubscription terms|billing|auto[\s-]?renew\b/.test(s)) return "billing";
    return null;
  }

  const SOURCE_LABEL = { page: "this page", terms: "Terms", privacy: "Privacy Policy", refund: "Refund policy", cancel: "Cancellation page", shipping: "Shipping policy", billing: "Billing terms", other: "linked page" };

  g.TERMSGUARD = { scanText, aggregate, classifyLink, CATEGORY_META, SOURCE_LABEL, RULES };
})(typeof globalThis !== "undefined" ? globalThis : self);
