# Terms Guard

Terms Guard is a Chrome extension that reads the fine print on signup, trial, and checkout pages so you don't have to. When you are about to start a free trial, subscribe, or pay, it scans the page along with the Terms, Privacy, Refund, and Cancellation pages it links to, and shows you the things worth knowing before you commit.

## What it looks for

Auto-renewals and free trials that turn into paid plans. Cancellation terms that make you call or mail in a request. Short or missing refund windows. Binding arbitration and class-action waivers. Prices that go up after an introductory period. Clauses about sharing or selling your data. Minimum commitments, early-termination fees, restocking fees, and final-sale conditions.

Each finding tells you which document it came from (the page itself, the Terms, the Refund policy, and so on) and lets you read the exact sentence it was based on.

## Cancel reminders

If it finds a free trial, you can set a reminder in one click. Terms Guard saves the cancellation link and sends you a browser notification a day before the trial renews, so you can cancel before you get charged. Your reminders are listed in the popup.

## Privacy

Everything runs locally in your browser. Terms Guard does not collect, store, or send your browsing data anywhere. There are no accounts, no analytics, and no third-party servers. The source is here so you can check that for yourself. See privacy.html for the full policy.

## Permissions

- Host access to websites: needed to read the current page and to fetch the policy pages it links to. The text is analyzed locally and never leaves your browser.
- Storage: saves your settings, your reminders, and a temporary 24-hour cache so the same pages are not fetched over and over.
- Alarms: schedules the cancel reminders you create.
- Notifications: shows those reminders before a trial renews.

## Install from source

1. Download or clone this repository.
2. Open chrome://extensions in Chrome.
3. Turn on Developer mode using the toggle in the top right.
4. Click Load unpacked and select this folder.

## License

MIT. See LICENSE.
