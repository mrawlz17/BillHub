FlowMap v0.5.0
================

FlowMap is a private, local-first cash-flow planning web app. It uses the actual cleared bank balance as the current checkpoint, then projects known income, bills, spending pools, extras, and catch-up payments forward for six months.

IMPORTANT UPDATE RULE
---------------------
Do not reset or re-import your financial data when deploying this update.
Replace the hosted app files only. FlowMap intentionally keeps the existing IndexedDB database name (billhub-db) so data from Bill Hub v0.4.0 and earlier remains in place.

The v0.5 update path does not rewrite financial records on app load. Before Update & Reload or Force Refresh, FlowMap stores one temporary update guard containing the current local state. On the next load it compares the financial data. If anything changed unexpectedly, FlowMap restores the pre-update state automatically. The guard is deleted after the verification and is not a user-facing automatic backup system.

WHAT CHANGED IN v0.5.0
----------------------
1. True delete for one-time/manual entries
   - Catch-up payments, extras, reconciliation entries, and other one-time manual entries can be deleted.
   - Recurring items still use Skip This Month.
   - Recent changes can be undone during the current session.

2. Six-month forecast only
   - Current month plus the next five months.
   - No 3/6/12 selector.

3. Home layout redesign
   - Simplified top status cards.
   - One unified 6-Month Forecast replaces duplicated Current Month / Next Up / Outlook sections.
   - Current month is always expanded with all remaining projected events.
   - Future months are collapsed and can be expanded one at a time.

4. Automatic local snapshots removed
   - No automatic snapshot creation or snapshot restore UI.
   - Manual encrypted backup/restore remains.

5. Version and update controls
   - Installed version in Settings.
   - Automatic hosted version check.
   - Check Update, Update & Reload, and Force Refresh controls.

6. Reset Data protection
   - Dedicated destructive confirmation.
   - Back Up First option.
   - User must type DELETE before Reset Data is enabled.

7. Recent Activity + Undo
   - Reports shows recent in-app changes.
   - Undo is available for the latest change in the current session.

8. Entry badges
   - CATCH-UP, EXTRA, OVERRIDE, POOL, SKIPPED, and RECONCILE identify why a cash-flow item exists.

9. Backup status + restore preview
   - Settings shows the last manual backup and backup age.
   - Restore previews the backup before replacing current local data.
   - FlowMap can restore both new FlowMap backups and legacy Bill Hub encrypted backups.

10. Update-safe data protection
   - App version is separate from stored financial data.
   - App load performs only additive runtime defaults; it does not rewrite bill names, amounts, statuses, dates, or month overrides.
   - Update/refresh uses a temporary financial integrity guard and automatically restores the pre-update state if an unexpected data change is detected.

11. Current-month-first Home
   - Current month is expanded by default and cannot be accidentally collapsed.
   - Future five months remain expandable.

12. Copy and terminology cleanup
   - Dashboard renamed Home.
   - Removed redundant explanatory copy and the PRIVATE CASH-FLOW PLANNER header.
   - Short, consistent labels across Home, Plan, Reports, and Settings.

13. Rebrand to FlowMap
   - App title, manifest, backup filenames, setup copy, Settings, and navigation now use FlowMap.
   - Existing IndexedDB storage is preserved for compatibility.

14. New FlowMap visual system
   - Dark charcoal layered UI.
   - Accent palette: green #22C55E, yellow #FACC15, red #EF4444, blue #3B82F6, purple #8B5CF6.
   - FlowMap F-arrow brand mark in the header.
   - App icon combines the cash-bill concept with the forward F/flow arrow.
   - Included 512, 192, 180, 64, and 32 px icon assets.

Additional safety improvement
-----------------------------
Large balance reconciliation differences (>= $500) now display a warning and require an additional confirmation before FlowMap creates a large Misc Daily or Uncategorized Credit entry.

FILES TO DEPLOY
---------------
Upload/replace the contents of the app/ folder at the same GitHub Pages location used by the existing app:
- index.html
- styles.css
- app.js
- manifest.webmanifest
- version.json
- sw.js
- icons/ folder

Do not upload PRIVATE_DO_NOT_UPLOAD.

BACKUPS
-------
New exports are named FlowMap_Backup_YYYY-MM-DD.bhub and use the FlowMap encrypted backup format. FlowMap v0.5.0 still accepts legacy billhub-encrypted-v1 backups.

DATA STORAGE
------------
Financial data remains local in IndexedDB. No personal financial seed is embedded in the deployable app files.
