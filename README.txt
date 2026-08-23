FlowMap v0.7.3
================

PURPOSE
-------
FlowMap is a local-first cash-flow planner. Your actual bank balance is the source of truth. Personal financial data remains in local browser storage and is not included in these release files.

WHAT CHANGED IN v0.7.3
----------------------
- Update Balance now recognizes every active current-month spending pool from its recurring rule, even when an older month-specific occurrence still carries a legacy type such as "bill".
- This fixes Apple/subscription spending pools not appearing beside Fuel and Groceries in the balance-allocation screen.
- The change does not alter the forecast, balances, statuses, or stored financial records by itself.
- No financial-data migration or automatic record rewrite is performed.

UPDATE PACKAGE
--------------
For an existing FlowMap installation, replace only the files included in the Update package:
- app.js
- finance-engine.js
- index.html
- sw.js
- version.json
- README.txt

Do not reset FlowMap, delete browser data, reseed the app, or restore a backup just to install this update.

FULL GITHUB PACKAGE
-------------------
The GitHub Files package contains the complete deployable app plus this README.

DATA SAFETY
-----------
Installing v0.7.3 does not intentionally rewrite your existing current balance, balance history, recurring rules, manual entries, statuses, overrides, goals, or planning settings.

BACKUPS
-------
Encrypted FlowMap backups remain compatible. Keep a current manual backup before replacing hosted app files.
