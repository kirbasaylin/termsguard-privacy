/* Terms Guard — popup */
const $ = (s) => document.querySelector(s);
let activeTabId = null;

function send(tabId, msg) {
  return new Promise((res) => chrome.tabs.sendMessage(tabId, msg, (r) => { if (chrome.runtime.lastError) return res(null); res(r); }));
}
function bg(msg) { return new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { if (chrome.runtime.lastError) return res(null); res(r); })); }

// tabs
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.tab;
    $("#tab-page").hidden = which !== "page";
    $("#tab-rem").hidden = which !== "rem";
    if (which === "rem") loadReminders();
  })
);

const RISK_TITLE = { clear: ["Looks clear", "No gotchas found on this page."], watch: ["Worth a look", "A few terms worth checking."], high: ["Read first", "Important fine print before you commit."] };

function showPage(view) {
  $("#verdict").hidden = view !== "verdict";
  $("#items").hidden = view !== "verdict";
  $("#scanned").hidden = view !== "verdict";
  $("#open").hidden = view !== "verdict";
  $("#nodecision").hidden = view !== "nodecision";
  $("#off").hidden = view !== "off";
}

function renderVerdict(r) {
  const v = r.verdict, meta = r.meta, SL = r.sourceLabel;
  const risk = v.count ? v.risk : "clear";
  $("#verdict").dataset.risk = risk;
  $("#vcount").textContent = v.count;
  const [t, s] = RISK_TITLE[risk] || ["", ""];
  $("#vtitle").textContent = v.count ? `thing${v.count === 1 ? "" : "s"} to check \u2014 ${t}` : t;
  $("#vsub").textContent = v.count ? `${s} (risk score ${v.score})` : s;

  const items = $("#items"); items.innerHTML = "";
  v.items.forEach((it) => {
    const where = [...new Set(it.sources.map((x) => SL[x.type] || "linked page"))].join(", ");
    const row = document.createElement("div");
    row.className = "item " + it.sev;
    row.innerHTML = `<span class="ic">${meta[it.cat].icon}</span><div class="ib">
      <div class="line">${esc(it.line)}</div>
      <div class="where">from ${esc(where)}</div>
      ${it.snippet ? `<div class="snip">\u201C${esc(it.snippet)}\u201D</div>` : ""}</div>`;
    items.appendChild(row);
  });

  $("#scanned").textContent = (r.scannedDocs && r.scannedDocs.length)
    ? "Scanned: " + r.scannedDocs.map((d) => SL[d.type] || "page").join(" \u00B7 ") : "";
  showPage("verdict");
}

async function loadPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) { showPage("nodecision"); return; }
  activeTabId = tab.id;
  const enabled = (await chrome.storage.sync.get({ enabled: true })).enabled;
  $("#enabled").checked = enabled;
  if (!enabled) { showPage("off"); return; }
  const r = await send(tab.id, { type: "GET_REPORT" });
  if (!r || !r.active || !r.verdict) { showPage("nodecision"); return; }
  renderVerdict(r);
}

async function loadReminders() {
  const list = (await bg({ type: "GET_REMINDERS" })) || [];
  const el = $("#remlist"); el.innerHTML = "";
  $("#noremind").hidden = list.length > 0;
  const bc = $("#remcount");
  if (list.length) { bc.hidden = false; bc.textContent = list.length; } else bc.hidden = true;
  list.sort((a, b) => a.renewAt - b.renewAt).forEach((rec) => {
    const row = document.createElement("div");
    row.className = "rem";
    row.innerHTML = `
      <div class="rem-top"><span class="rem-site">${esc(rec.site)}</span>
      <span class="rem-date">renews ${new Date(rec.renewAt).toLocaleDateString()}</span></div>
      <div class="rem-actions">
        <a href="${esc(rec.cancelUrl || rec.signupUrl)}" target="_blank">Cancel page</a>
        <button data-id="${rec.id}">Remove</button>
      </div>`;
    row.querySelector("button").addEventListener("click", async (e) => { await bg({ type: "DELETE_REMINDER", id: e.target.dataset.id }); loadReminders(); });
    el.appendChild(row);
  });
}

$("#enabled").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  e.target.checked ? setTimeout(loadPage, 200) : showPage("off");
});
$("#open").addEventListener("click", async () => { if (activeTabId) { await send(activeTabId, { type: "OPEN_CARD" }); window.close(); } });

function esc(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

loadPage();
bg({ type: "GET_REMINDERS" }).then((l) => { if (l && l.length) { $("#remcount").hidden = false; $("#remcount").textContent = l.length; } });
