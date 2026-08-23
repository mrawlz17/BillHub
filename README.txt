FlowMap v0.7.1
================

FlowMap is a private, local-first cash-flow planner. The actual cleared bank balance remains the source of truth. Known income, bills, spending pools, extras, catch-ups, savings transfers, and unresolved overdue items are projected forward from that checkpoint.

THIS RELEASE: BALANCE ALLOCATION FIX
------------------------------------
v0.7.1 fixes the daily balance workflow for Fuel/Groceries spending pools and removes the user-facing Financial Integrity panel from Settings.

Key changes:
- When a bank balance decreases, FlowMap now offers active current-month spending pools in the same balance-update dialog.
- You can allocate part of the bank decrease to Fuel, Groceries, or another active pool.
- The allocated amount reduces that pool's remaining future amount automatically.
- Only the unallocated remainder becomes Misc Daily.
- Pool spending is retained as a cleared classification record for category reporting without affecting the forecast a second time.
- The entire balance update + pool allocation + Misc remainder is one atomic action and one Undo operation.
- Fixed a storage-reference bug where editing an already-manualized month occurrence could appear to save while actually changing only a projected copy. Month-entry edits now resolve back to the stored manual record before mutation.
- Financial Integrity has been removed from Settings and no longer blocks Update & Reload / Force Refresh.
- The update guard remains in place to protect stored financial/planning data across app refreshes.

EXAMPLE
-------
Prior balance: $4,400
New bank balance: $4,320
Bank decrease: $80
Allocate to Fuel: $60

Result:
- Fuel remaining $240 -> $180
- Misc Daily $20
- Bank balance $4,320
- If the prior month ending was $700, the corrected month ending becomes $680 (all else equal).

FINANCIAL RULE
--------------
A spending pool is future money still expected to be spent. If actual bank spending comes from a pool, FlowMap must lower both the actual bank balance and the pool's remaining future amount. That prevents the same $60 from being counted once in the bank balance and again as future Fuel spending.

AUTOMATED RELEASE TESTING
-------------------------
The release suite remains a development/release gate even though the in-app Financial Integrity panel was removed. See tests/ and RELIABILITY_REPORT.md.

IMPORTANT UPDATE RULE
---------------------
Do not reset, reseed, or re-import your financial data when deploying this update.
Replace the hosted app files only. FlowMap intentionally keeps the legacy IndexedDB database name (billhub-db) so existing local financial data remains in place.

No financial schema migration or reseed is performed on startup.

FILES TO DEPLOY
---------------
Upload/replace the contents of the app/ folder at the same GitHub Pages location used by the existing app:
- index.html
- styles.css
- app.js
- finance-engine.js
- manifest.webmanifest
- version.json
- sw.js
- icons/ folder

If your FlowMap icons are already uploaded correctly, the icons do not need to be replaced for v0.7.1.

Do not upload PRIVATE_DO_NOT_UPLOAD.

DATA SAFETY
-----------
Installing v0.7.1 does not intentionally change:
- current balance checkpoint
- balance history
- recurring bills
- income schedules
- manual entries
- month overrides
- existing extras/catch-ups
- existing one-time/manual occurrences
- goals or savings transfers
- Minimum Balance setting

The new allocation workflow changes data only when you explicitly save a balance update.

BACKUPS
-------
FlowMap encrypted backups and legacy Bill Hub encrypted backups remain restorable.

DATA STORAGE
------------
Personal financial data remains local in IndexedDB. No user-specific financial data, backup contents, goals, or passphrases are embedded in the deployable app files or synthetic test suite.
