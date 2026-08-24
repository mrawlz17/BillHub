FlowMap v0.7.4
================

Purpose
-------
Adds optional external payment website links for recurring bills and spending pools.

What changed
------------
- Plan -> Bills & Income recurring items now have an optional Payment Website field.
- Saved links appear as "Open Website" only in Plan -> Bills & Income.
- Tapping the link opens the secure HTTPS site in a new external browser context.
- Payment links do not mark an item Pending, Cleared, or Paid. FlowMap status remains manual.
- Payment website metadata is not used by the finance/forecast engine.

Safety
------
- No database migration.
- No financial records are rewritten during the app update.
- No usernames, passwords, account numbers, or banking credentials should be stored in FlowMap.
- Only HTTPS payment websites are accepted.

UPDATE INSTALL
--------------
If updating from FlowMap v0.7.3, replace the app files included in the Update ZIP in the root of the GitHub Pages repository. Do not delete or reset browser data.

FULL GITHUB FILES
-----------------
The GitHub Files ZIP contains the complete deployable FlowMap app.
