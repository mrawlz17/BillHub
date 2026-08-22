FlowMap v0.6.0
================

FlowMap is a private, local-first cash-flow planning web app. The actual cleared bank balance remains the source of truth. Known income, bills, spending pools, extras, catch-ups, and deliberate savings transfers are projected forward from that balance checkpoint.

IMPORTANT UPDATE RULE
---------------------
Do not reset or re-import your financial data when deploying this update.
Replace the hosted app files only. FlowMap intentionally keeps the existing IndexedDB database name (billhub-db) so the current local balance, balance history, bills, income rules, manual entries, and overrides remain in place.

v0.6.0 also keeps the update-safety system introduced in v0.5.0. A temporary update guard protects the stored financial/planning state during Update & Reload or Force Refresh. The guard is deleted after verification and is not a user-facing automatic snapshot system.

NEW IN v0.6.0
-------------
15. Minimum Balance planning floor
    - Default: $500.
    - Adjustable under Settings > Planning.
    - Used by Savings Goals and What If.
    - A warning/guardrail only; it does not block intentional plans.
    - Changing the setting never moves money or changes the current bank balance.

16. Savings Goals
    - Plan tab now includes Goals.
    - Create a goal with name, target amount, target date, and any amount already saved outside FlowMap.
    - FlowMap projects recurring cash flow through the goal date and builds a Safe-to-Save recommendation while respecting the Minimum Balance floor.
    - Goal planning itself does not modify the real forecast or bank balance.
    - Schedule Transfer deliberately adds a savings transfer to the real forecast.
    - Savings transfers reduce projected checking just like real money leaving checking, but are stored as transfers rather than spending and are excluded from Spending by Category.
    - Scheduled and cleared goal transfers are tracked against the goal.

17. What If
    - Plan tab now includes What If.
    - Enter a purchase amount, date, name, and category.
    - FlowMap runs the six-month forecast with the hypothetical purchase and compares each month-end balance with the current plan.
    - It flags negative balances and balances below the Minimum Balance floor.
    - Running or clearing a scenario writes nothing to stored financial data.
    - Add to Plan is the explicit commit action that turns the scenario into a real one-time extra.

PLAN NAVIGATION
---------------
The existing Plan tab now contains three internal sections instead of adding more bottom navigation tabs:
- Goals
- What If
- Bills & Income

BALANCE SAFETY
--------------
The following remain unchanged by simply installing v0.6.0:
- Current balance checkpoint
- Balance history
- Recurring bills
- Income schedules
- Pending/upcoming/cleared statuses
- Month overrides
- Existing extras and catch-ups
- Existing forecast inputs

Goals and What If read the existing cash-flow engine. They do not rewrite historical or current balance data.

WHAT CARRIES FORWARD FROM v0.5.0
--------------------------------
- Six-month Home forecast only: current month + next five.
- Current month expanded; future months collapsible.
- True delete for one-time/manual entries.
- Manual encrypted backup/restore only; no automatic local snapshots.
- Backup freshness and restore preview.
- Recent Activity + Undo.
- Protected Reset Data flow.
- App version, update check, Update & Reload, and Force Refresh.
- Update-safe financial-data guard.
- FlowMap branding, charcoal UI, and green/yellow/red/blue/purple accent system.
- FlowMap cash/F-arrow app icon and F-arrow header mark.
- Large balance-reconciliation warning for unexplained differences of $500 or more.

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

The icons are unchanged from v0.5.0. If the current FlowMap icons are already uploaded correctly, they do not need to be replaced for v0.6.0.

Do not upload PRIVATE_DO_NOT_UPLOAD.

BACKUPS
-------
New exports remain encrypted FlowMap backups and legacy Bill Hub encrypted backups remain restorable.

DATA STORAGE
------------
Personal financial data remains local in IndexedDB. No user-specific financial seed or savings goal is embedded in the deployable app files.
