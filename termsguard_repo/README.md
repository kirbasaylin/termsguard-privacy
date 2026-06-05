# Terms Guard — *Before You Sign Up*

A Chrome (Manifest V3) extension that catches the fine print **at the moment you're about to commit**. When you land on a trial, subscription, signup, or checkout page, Terms Guard quietly scans the page *and the linked Terms / Privacy / Refund / Cancellation pages*, then tells you the gotchas in plain English:

> **This signup has 8 things to check:**
> 🔁 Auto-renews after the 7-day trial · 🚪 Cannot cancel online — must call · ⚖️ You'd give up the right to join a class action · ↩️ No refunds / all sales final · 💸 Restocking fee applies …

Each item shows **where it came from** ("from Terms", "from Refund policy") and a "show where" button that reveals the exact sentence.

## What it catches
Auto-renewal · free-trial-to-paid conversion · hard-to-cancel terms (call/mail/notice-period) · refund limits & windows · binding arbitration / class-action waivers · price jumps after an intro period · data sharing/selling · minimum commitments & early-termination fees · restocking/handling fees · final-sale & return-shipping conditions.

## Why this is different
- **Decision-moment, not a doc summarizer.** It only wakes up on signup/checkout pages and answers one question: *what should I know before I click pay?*
- **It reads the linked legal pages for you.** Most tools only see the page you're on. Terms Guard fetches and scans the Terms, Refund, and Cancellation pages too, then attributes each risk to its source.
- **Concrete, not fuzzy.** "Refund window is 48 hours" and "must call to cancel" are facts, not vibes.
- **Built-in Trial Trap.** Found a trial? One click sets a local reminder (with a browser notification a day before renewal) and saves the cancellation link. See all your reminders in the popup.
- **100% local.** Page text is analyzed in your browser. Nothing you visit is sent anywhere.

## Install (developer mode)
1. Unzip this folder.
2. Open `chrome://extensions/`, turn on **Developer mode**.
3. **Load unpacked** → select the `termsguard` folder.
4. Visit a trial/checkout page — the Terms Guard card slides up bottom-right.

## How it works
- `detectors.js` — the risk engine (regex dictionaries + negation handling + specifics extraction). Shared verbatim by the content script and the service worker.
- `content.js` — detects decision pages, scans the page, finds candidate legal links, asks the worker to fetch+scan them, renders the verdict card, and sets cancel reminders.
- `background.js` — fetches linked docs (cross-origin via `host_permissions`), strips HTML to text, scans, caches 24h, and runs the reminder alarms + notifications.
- `popup.*` — current-page verdict, a Reminders dashboard, and the on/off switch.

## Permissions, plainly
- `host_permissions: <all_urls>` — needed so the worker can fetch the Terms/Refund pages a checkout links to. (Required for the core feature; nothing is uploaded.)
- `alarms`, `notifications` — for cancel reminders. `storage` — settings, reminders, and a 24h doc cache.

## Tuning
All detection lives in the `RULES` array in `detectors.js`. Each rule has a category, severity, a regex, an optional `reject` (negation guard), and a `detail()` that extracts specifics (trial length, refund window, price-after-intro). Add patterns there. Risk thresholds and the verdict are in `aggregate()`.

## Roadmap
- Optional AI explainer ("why does this clause matter?") via an LLM API — the one piece that would need a key.
- A crowd database of "how to cancel X" per service.
- Locale packs (rules are English-only today).
- SPA-rendered terms pages (fetch currently reads static HTML).

## License
MIT.
