FlowMap v0.7.0
================

FlowMap is a private, local-first cash-flow planner. The actual cleared bank balance remains the source of truth. Known income, bills, spending pools, extras, catch-ups, savings transfers, and unresolved overdue items are projected forward from that checkpoint.

THIS RELEASE: RELIABILITY HARDENING
-----------------------------------
v0.7.0 is deliberately focused on forecast reliability rather than adding another feature.

Key changes:
- New dedicated finance-engine.js is the single authoritative cash-flow calculation layer.
- Formal state-machine rules for Upcoming, Pending, Cleared, Skipped, Expected income, Received income, and overdue unresolved items.
- Upcoming/Pending outflows remain in forecast until Cleared, Skipped, or deleted when deletion is allowed.
- Expected income remains in forecast until Received or explicitly Skipped / not received.
- Balance checkpoints materialize crossed recurring outflow AND income occurrences so passing time cannot silently remove money from the plan.
- Home, What If, Goals, Reports, Pending total, and category spending use the shared finance engine.
- Financial Integrity panel added under Settings.
- Update & Reload / Force Refresh now run Financial Integrity first and block the refresh if a hard integrity check fails.
- Update guard upgraded to canonical financial/planning fingerprints.
- Balance reconciliation now detects exact matches to one or a combination of up to three unresolved items and warns before creating a reconciliation that could double-count the money.

AUDIT FIXES FOUND BEFORE RELEASE
--------------------------------
The reliability test suite found and fixed two additional logic defects:

1. Six-month boundary leak
   - Older projection logic could include several days from month seven even though Home showed six months.
   - v0.7.0 stops exactly at the end of current month + next five.

2. Biweekly daylight-saving drift
   - Fixed-millisecond 14-day increments could shift one hour after DST and omit a payday on the last day of a forecast month.
   - v0.7.0 uses calendar-day increments and preserves the intended biweekly date.

AUTOMATED RELEASE GATE
----------------------
Before packaging v0.7.0, the finance engine passed:
- 21 deterministic/regression tests
- 10,000 randomized forecast comparisons against a separate reference oracle
- 5,000 randomized accounting-invariant checks
- 15,000 randomized scenarios/states total
- 0 test failures

The current encrypted FlowMap backup was also tested locally without embedding personal data in the package. Projection and integrity calculations did not mutate the stored state. It produced no integrity failures; one review warning remains for an existing reconciliation entry at or above $500.

See:
- FINANCIAL_RULES.md
- RELIABILITY_REPORT.md
- tests/run-tests.js

IMPORTANT UPDATE RULE
---------------------
Do not reset, reseed, or re-import your financial data when deploying this update.
Replace the hosted app files only. FlowMap intentionally keeps the legacy IndexedDB database name (billhub-db) so existing local financial data remains in place.

The update guard is temporary and exists only to validate an app refresh/update. It is deleted after verification and is not the removed automatic snapshot feature.

FILES TO DEPLOY
---------------
Upload/replace the contents of the app/ folder at the same GitHub Pages location used by the existing app:
- index.html
- styles.css
- app.js
- finance-engine.js   <-- NEW in v0.7.0
- manifest.webmanifest
- version.json
- sw.js
- icons/ folder

If your FlowMap icons are already uploaded correctly, the icons do not need to be replaced for v0.7.0.

Do not upload PRIVATE_DO_NOT_UPLOAD.

DATA SAFETY
-----------
Installing v0.7.0 does not intentionally change:
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

No financial schema migration or reseed is performed on startup.

BACKUPS
-------
FlowMap encrypted backups and legacy Bill Hub encrypted backups remain restorable.

DATA STORAGE
------------
Personal financial data remains local in IndexedDB. No user-specific financial data, backup contents, goals, or passphrases are embedded in the deployable app files or included in the automated synthetic test suite.
