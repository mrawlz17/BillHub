BILL HUB v0.4.0

PURPOSE
Bill Hub is a private/local cash-flow planner. The actual bank balance is the source-of-truth checkpoint; future bills and income are projected from that checkpoint.

UPDATE / INSTALL
- The app/ folder is the generic deployable shell and contains no personal financial values.
- Replacing the hosted app/ files does NOT erase the browser's IndexedDB financial data.
- If you are updating an existing Bill Hub install, deploy the new app/ files and open the app. Existing local data migrates in place.
- Keep an encrypted .bhub backup before major changes or moving to another device/browser.

V0.4.0 — DAILY-USE / SAFETY UPDATE
1. One-time/manual entries can now be truly deleted.
   - Catch-up payments, extras, reconciliation entries, and other one-time manual items can be removed.
   - Recurring occurrences still use Skip This Month rather than deleting the recurring rule.
   - Delete actions are undoable during the current app session.

2. Rolling forecast is fixed to six months.
   - Current month + next five months only.
   - Removed 3/6/12 month selector.

3. Dashboard layout redesigned around actual daily use.
   - Current position cards.
   - This Month summary.
   - Next Up events.
   - Six-Month Outlook.
   - Detailed monthly cash flow moved to a tap-to-open month detail sheet instead of a giant dashboard ledger.

4. Automatic local snapshots removed.
   - No app-open snapshots.
   - No snapshot restore prompt.
   - Existing old snapshot data is discarded on first v0.4.0 load.
   - Encrypted manual backup/restore remains the recovery method.

5. App version and update controls added to Settings.
   - Displays installed version.
   - Automatically checks version.json on the hosted app.
   - Shows Up to date / Update available.
   - Check for update, Update & reload, and Force refresh app controls.
   - Refresh/update clears app caches only; IndexedDB financial data is not cleared.

6. Reset Local Data safety strengthened.
   - Dedicated destructive-action sheet.
   - Back Up First option.
   - Must type DELETE before the final reset button is enabled.

7. Recent Activity + Undo added.
   - Reports shows recent Bill Hub changes.
   - Most edits/adds/deletes/balance changes can be undone once during the current app session.
   - A temporary Undo toast appears after reversible actions.

8. Cash-flow entries now identify why they exist.
   - CATCH-UP, EXTRA, OVERRIDE, POOL, SKIPPED, and RECONCILE labels appear where applicable.
   - Item editor explains whether the item is recurring, a month override, or a one-time entry.

9. Manual backup freshness + restore preview added.
   - Settings shows the last recorded manual backup time.
   - Warns when the recorded backup is 14+ days old.
   - Encrypted restore now previews backup date, version, balance checkpoint, recurring bill count, and income source count before replacing local data.

ADDITIONAL INTERNAL FIX
- Legacy financial migration routines were removed from the public app shell. v0.4.0 migration only normalizes generic app metadata and never rewrites stored financial names, amounts, statuses, or month overrides.

DATA MODEL
- Upcoming = not submitted yet; remains projected.
- Pending = submitted/initiated but not yet cleared; remains projected because the bank balance still includes it.
- Cleared = expense actually left the bank.
- Received = income actually reached the bank.
- Daily balance updates reconcile unexplained decreases to Misc Daily and unexplained increases to Uncategorized Credit.
- Spending pools represent remaining expected commitments, not transaction-by-transaction spending.
- Each month ends at its projected bank balance; that exact ending becomes the next month's starting balance.

BACKUPS
- Top Backup button and Settings > Export encrypted backup create an AES-GCM encrypted .bhub file using a passphrase you choose.
- Bill Hub records the export time locally to show backup freshness.
- Restore encrypted backup decrypts the file, shows a preview, and only replaces local state after explicit confirmation.
- Keep backup files somewhere external to the browser (for example Files/iCloud Drive).

UPDATES
- app/version.json is the hosted version marker. Publish it with every release and update its version value.
- Bill Hub checks that file with cache disabled.
- Force Refresh clears Cache Storage/service-worker shell cache and reloads the hosted app. It does not delete IndexedDB.

PRIVACY
- app/ is safe to host as a generic shell because it contains no personal seed values.
- Financial data remains in browser IndexedDB unless the user explicitly restores/imports data or resets local data.
