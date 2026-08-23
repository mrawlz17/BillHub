FlowMap v0.7.2
================

PURPOSE
-------
FlowMap is a local-first cash-flow planner. Your actual bank balance is the source of truth. Personal financial data remains in local browser storage and is not included in these release files.

WHAT CHANGED IN v0.7.2
----------------------
- Fixed occurrence matching for recurring schedules that can happen more than once in the same month.
- Editing, preserving, receiving, skipping, or moving one biweekly/twice-monthly occurrence no longer suppresses the other occurrences in that month.
- Each materialized recurring occurrence now carries its original occurrence date so a date change suppresses only the occurrence it replaced.
- Monthly recurring bills keep their existing one-month-only override behavior.
- No financial-data migration or automatic record rewrite is performed by this update.

WHY THIS MATTERS
----------------
A September 4 Midcon occurrence can now be preserved or edited without removing September 18 from the forecast.
Likewise, a September 10 CSS occurrence can be preserved or edited without removing September 25.

UPDATE PACKAGE
--------------
For an existing FlowMap installation, replace only the files included in the Update package.

For v0.7.2 those files are:
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
Installing v0.7.2 does not intentionally rewrite your existing current balance, balance history, recurring rules, manual entries, statuses, overrides, goals, or planning settings.

BACKUPS
-------
Encrypted FlowMap backups remain compatible. Keep a current manual backup before replacing hosted app files.
