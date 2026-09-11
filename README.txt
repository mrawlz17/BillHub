FlowMap v0.7.9

PURPOSE
-------
v0.7.9 is a presentation and feature-cleanup release. It does not change Finance Engine 1.0.4 or any stored financial data.

WHAT CHANGED
------------
- Removed the deprecated scenario-planning module from Plan, including its UI, event handlers, code, and styles.
- Removed the deprecated category-spending report from Reports, including its UI and app-side rendering.
- Reports now contains Recent Activity and Balance History only.
- Renamed the Settings planning panel to Savings Safety and rewrote the copy to describe only the savings-goal minimum-balance floor.
- Simplified cash-item markers with deterministic precedence:
  1. Pending is shown alone once an outflow is submitted.
  2. Unresolved spending pools show Pool alone.
  3. Overdue replaces Upcoming.
  4. Cleared / Received / Skipped stand alone.
  5. Otherwise Upcoming is the state marker, with at most one contextual marker (Catch-up, Extra, Reconcile, Transfer, or Override).
- Home layout and financial amounts are unchanged. Only marker presentation changed.

FINANCIAL DATA SAFETY
---------------------
- Finance Engine 1.0.4 is byte-for-byte unchanged from v0.7.8.
- No database migration.
- No schema change.
- No automatic financial-record rewrite.
- No balance-history rewrite.
- No bill, income, recurring-schedule, status, pool, or forecast-calculation change.
- Existing data remains in billhub-db / kv IndexedDB.

NOTE ON REMOVED REPORT CODE
---------------------------
The removed report has no UI or app-side rendering path in v0.7.9. The locked Finance Engine 1.0.4 remains byte-for-byte unchanged; one dormant historical aggregation helper remains inside that verified engine file and is not called by the app.

INSTALL
-------
For an existing FlowMap installation, upload all files from the v0.7.9 Update package. Do not reset or restore financial data for this update.
