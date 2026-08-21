BILL HUB v0.1.1

WHAT THIS PACKAGE CONTAINS
- app/                     Generic Bill Hub application shell. No personal financial seed data is embedded here.
- PRIVATE_DO_NOT_UPLOAD/   Your private starting data. NEVER upload this folder to a public repository.

FIRST RUN
1. Serve/open the contents of app/ from a web server.
2. Bill Hub will show a setup screen.
3. Choose "Import private seed".
4. Select PRIVATE_DO_NOT_UPLOAD/billhub-private-seed.json.
5. After import, the financial data is stored in the browser's IndexedDB.

DATA MODEL
- Actual bank balance is the source-of-truth checkpoint.
- Upcoming = not submitted yet.
- Pending = payment submitted but has not cleared the bank.
- Cleared = transaction has left the bank.
- Daily balance updates reconcile unexplained decreases to "Misc Daily".
- Unexplained increases become "Uncategorized Credit".
- Recurring bills and income generate future projections.
- A $700 September catch-up reserve is included as a reserve, not a fake bank transaction.

BACKUPS
- The app creates a local IndexedDB snapshot on every open and keeps the latest 30.
- It also snapshots before destructive actions and balance updates.
- Settings > Export encrypted backup creates an AES-GCM encrypted .bhub file using a passphrase you choose.
- Keep that backup in iCloud Drive/Files if desired.

KNOWN ITEMS NOT AUTOMATED YET
- The old ATV $215 grouping has been split into Kayo $75/month and Kawasaki $140/month, both due on the 12th.
- "Comm" and "Taxes" are treated as one-time extras rather than recurring bills.
- August values that differ from normal recurring defaults are entered as August-specific manual items.
- The first version has core add forms but not full edit/delete UI for every rule yet.

PRIVACY
The app/ folder is safe to host as a generic shell because it contains no personal seed values.
Do not publish PRIVATE_DO_NOT_UPLOAD.
