/* Terms Guard — service worker */
importScripts("detectors.js");
const TG = self.TERMSGUARD;

const RISK_COLOR = { clear: "#2e9e63", watch: "#d9920c", high: "#e4573d", off: "#8a8f98" };
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ---------- strip HTML to readable text ----------
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section)>/gi, ". ")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&[a-z]+;/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

async function fetchDoc(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, credentials: "omit", redirect: "follow" });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/html|text/.test(ct)) return null;
    const html = await r.text();
    return htmlToText(html).slice(0, 200000);
  } catch (e) { clearTimeout(to); return null; }
}

async function scanDocs(urls) {
  const findings = [];
  const fetched = [];
  const cacheKey = "doccache";
  const store = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
  const now = Date.now();

  await Promise.all(urls.slice(0, 4).map(async ({ url, type }) => {
    const c = store[url];
    if (c && now - c.t < CACHE_TTL) {
      // cached scan result — reuse without refetching or restoring giant text
      (c.f || []).forEach((x) => findings.push({ ...x, source: { type, url } }));
      fetched.push({ type, url, ok: true });
      return;
    }
    const text = await fetchDoc(url);
    if (text) {
      const f = TG.scanText(text, { type, url });
      f.forEach((x) => findings.push(x));
      // store only the compact findings (cat/sev/line/snippet), never the raw page text
      store[url] = { t: now, f: f.map((x) => ({ cat: x.cat, sev: x.sev, line: x.line, snippet: x.snippet })) };
      fetched.push({ type, url, ok: true });
    } else {
      fetched.push({ type, url, ok: false });
    }
  }));

  // prune cache (findings are tiny, but keep it bounded anyway)
  const keys = Object.keys(store);
  if (keys.length > 150) keys.slice(0, keys.length - 150).forEach((k) => delete store[k]);
  chrome.storage.local.set({ [cacheKey]: store });

  return { findings, fetched: fetched.filter((d) => d.ok) };
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.type === "FETCH_DOCS") {
    scanDocs(msg.urls || []).then(send);
    return true;
  }
  if (msg.type === "REPORT" && sender.tab) {
    const tabId = sender.tab.id;
    const text = msg.risk === "off" ? "" : msg.count > 0 ? String(msg.count) : "\u2713";
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: RISK_COLOR[msg.risk] || RISK_COLOR.off });
    return false;
  }
  if (msg.type === "SET_REMINDER") {
    saveReminder(msg.record).then(send);
    return true;
  }
  if (msg.type === "GET_REMINDERS") {
    chrome.storage.local.get({ reminders: [] }).then((r) => send(r.reminders));
    return true;
  }
  if (msg.type === "DELETE_REMINDER") {
    deleteReminder(msg.id).then(send);
    return true;
  }
});

// ---------- reminders ----------
async function saveReminder(rec) {
  const id = "rem_" + rec.createdAt + "_" + Math.random().toString(36).slice(2, 6);
  rec.id = id;
  const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
  reminders.push(rec);
  await chrome.storage.local.set({ reminders });
  // fire a day before renewal (or in 5s if that's already past — for testing/short trials)
  const when = Math.max(Date.now() + 5000, rec.renewAt - 86400000);
  chrome.alarms.create(id, { when });
  return { ok: true, id };
}

async function deleteReminder(id) {
  const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
  await chrome.storage.local.set({ reminders: reminders.filter((r) => r.id !== id) });
  chrome.alarms.clear(id);
  return { ok: true };
}

async function rehydrateAlarms() {
  const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
  const now = Date.now();
  for (const rec of reminders) {
    if (!rec.id) continue;
    const existing = await chrome.alarms.get(rec.id);
    if (existing) continue; // alarm still scheduled, leave it
    // recreate: fire a day before renewal, or in ~1 min if that moment already passed
    const when = rec.renewAt - 86400000 <= now ? now + 60000 : rec.renewAt - 86400000;
    chrome.alarms.create(rec.id, { when });
  }
}
chrome.runtime.onStartup.addListener(rehydrateAlarms);
chrome.runtime.onInstalled.addListener(rehydrateAlarms);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
  const rec = reminders.find((r) => r.id === alarm.name);
  if (!rec) return;
  chrome.notifications.create(rec.id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Cancel reminder \u2014 " + rec.site,
    message: `Your trial/subscription on ${rec.site} renews soon. Cancel now if you don't want to be charged.`,
    buttons: [{ title: "Open cancellation page" }, { title: "Dismiss" }],
    requireInteraction: true,
  });
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  if (btnIdx === 0) {
    const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
    const rec = reminders.find((r) => r.id === notifId);
    if (rec) chrome.tabs.create({ url: rec.cancelUrl || rec.signupUrl });
  }
  chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  const { reminders = [] } = await chrome.storage.local.get({ reminders: [] });
  const rec = reminders.find((r) => r.id === notifId);
  if (rec) chrome.tabs.create({ url: rec.cancelUrl || rec.signupUrl });
  chrome.notifications.clear(notifId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") chrome.action.setBadgeText({ tabId, text: "" });
});
