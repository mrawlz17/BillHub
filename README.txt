FlowMap v0.7.8

PURPOSE
-------
v0.7.8 hardens FlowMap against mixed-version app installs. It does not change the v1.0.4 finance calculations introduced in v0.7.7.

WHAT CHANGED
------------
- The verified finance engine now uses a versioned filename: finance-engine-1.0.4.js.
- The engine file is byte-for-byte the same finance logic as v0.7.7 engine 1.0.4.
- The HTML pins that exact engine file with a Subresource Integrity (SHA-256) check.
- FlowMap verifies engine version and four finance-engine contract tests before opening local financial data.
- FlowMap runs additional read-only checks against the current local financial state before rendering balances or forecasts.
- If verification fails, FlowMap stops safely instead of showing possibly incorrect numbers.
- A Repair App Files control clears only app caches/service workers and reloads fresh files. It does not touch IndexedDB financial data.
- Settings now shows both App Version and Finance Engine Version.
- Core app/engine/style assets use network-first service-worker loading with cache fallback to reduce stale mixed-file installs.

FINANCIAL DATA SAFETY
---------------------
- No database migration.
- No automatic financial-record rewrite.
- No balance-history rewrite.
- No changes to bill amounts, income amounts, payment states, recurring schedules, spending pools, or existing month overrides.
- Existing data remains in the same billhub-db / kv IndexedDB storage.
- Startup verification is read-only.

INSTALL
-------
For an existing FlowMap installation, upload all files from the v0.7.8 Update package. Then open FlowMap normally.

If FlowMap detects a stale or mismatched engine, it will stop safely and offer Repair App Files. Do not reset or restore your financial data for an app-file mismatch.
