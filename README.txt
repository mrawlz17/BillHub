BILL HUB v0.2.1

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

V0.1.2 FIXES
- 8/21 Midcon paycheck is no longer projected a second time when the starting balance already includes it.
- A manually submitted recurring bill suppresses that month's generated copy, even when it was submitted before its due date.
- Date-only display no longer shifts one day backward because of UTC parsing.
- Recurring bills on the Plan screen are sorted by due date.
- Monthly reserve display now distinguishes projected bank balance from money reserved / safe to spend.
- Existing v0.1.1 browser data is migrated automatically when the updated app shell is opened.

V0.1.3 FIX
- August Groceries $250 and Fuel $240 are remaining spending-pool balances.
- They are now Upcoming pool commitments, NOT Pending submitted payments.
- They continue to reduce the cash-flow forecast until spent/reduced, but are excluded from Pending Outflows.
- Existing v0.1.2 local data auto-migrates when this version opens.

V0.2.0 MONTH-SPECIFIC EDITING
- Tap any Upcoming Cash Flow row to open an editor instead of blindly cycling status.
- Edit amount, date, category, and status for THIS occurrence only.
- Spending pools label the amount as remaining for the period.
- Edit the recurring bill/income rule separately; month overrides stay intact.
- Skip a recurring occurrence for one month without changing future months.
- Add an extra/catch-up payment tied to the original bill for category/reporting continuity.
- Plan-screen recurring bill and income rows are now tappable for direct recurring-rule edits.
- Automatic local snapshots are created before month edits, rule edits, skips, and adds.
- Existing v0.1.3 IndexedDB data migrates to v0.2.0 automatically.

- August remaining Groceries $250 and Fuel $240 now replace the normal second-half $400/$300 pool commitments instead of being added on top.

V0.2.1 FIXES
- Removed the reserve/carryover feature entirely.
- Each month's projected ending bank balance automatically becomes the next month's starting balance.
- The old $700 September reserve is removed from both new seed data and existing browser data.
- T Car is suppressed for August 2026 because it was not among the remaining obligations at the 8/21 starting checkpoint.
- T Car continues normally in future months.
- Existing v0.2.0 local data auto-migrates on open.
