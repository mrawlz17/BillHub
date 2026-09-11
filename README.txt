FlowMap v0.7.7

WHAT CHANGED
------------
v0.7.7 fixes a forecast-integrity bug involving resolved recurring overrides (especially skipped occurrences) after a later balance checkpoint moves past the override date.

A resolved skip/override now continues to suppress its intended generated recurring occurrence for the correct month/occurrence even after the skip record itself is behind the current checkpoint.

WHY THIS MATTERS
----------------
In the current September 2026 data, the September Student Loans occurrence was intentionally skipped. Its stored skip record was dated September 10 while the recurring rule is now due on the 25th. After the September 11 balance update, v0.7.6 stopped seeing the past resolved skip while building suppression rules and incorrectly regenerated a $460 September Student Loans payment.

v0.7.7 preserves the skip and prevents that duplicate $460 outflow.

DATA SAFETY
-----------
- No database migration.
- No automatic financial-record rewrite.
- No balance-history rewrite.
- No change to bill amounts, income amounts, payment states, or spending-pool balances.
- Existing data remains in the same IndexedDB database/store.

INSTALL
-------
For an existing FlowMap installation, upload the files from the Update package and use Update & Reload / Force Refresh as needed.

No reset, restore, reseed, or manual data correction is required for this fix.
