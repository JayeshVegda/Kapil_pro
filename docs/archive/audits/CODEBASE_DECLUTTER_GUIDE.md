# 🧭 Kapil Billing — Codebase File Catalog & Decluttering Master Guide

> **Target Audience:** Incoming AI Coding Assistant / Systems Engineer  
> **Repository:** `Kapil_pro` (`feat/muse-integration`)  
> **Workstation Host:** Arch Linux / CachyOS (Primary Runtime: Windows Local PC with PocketBase SQLite)  
> **Verification Command:** `npm run verify` (`npm run typecheck && npm test && npm run build`)

---

## 1. Executive Briefing & Non-Negotiable Invariants

Kapil Billing is an on-premise business management system tailored specifically for a brass hardware manufacturing firm in Jamnagar, Gujarat. The business is operated by a **single user (the owner)** who manages three distinct operational workflows:
1. **Sales Billing** (GST-compliant outbound invoice generation for brass parts, customer ledgers, collections).
2. **Purchase / Procurement** (Scrap brass intake, supplier khata/ledger with dual Kacha & GST pools, weight deductions, bardan/bag tracking).
3. **Casting & Melting** (Foundry batches, scrap melting logs, wire-out yield tracking, casting bills).

### ⚠️ Non-Negotiable Invariants (DO NOT BREAK)
When cleaning or refactoring this codebase, you **must adhere to these 6 golden rules**:
1. **The Three-Module Isolation Rule**: Sales, Purchase, and Casting are **completely separate data worlds**. Even if an item has the identical name in Sales ("Brass Scrap") and Purchase ("Brass Scrap") or Casting, **never link them by ID or foreign key**. Each module has its own independent items table (`items`, `purchase_items`, `casting_items`).
2. **Dual Monetary Precision Standard**:
   - **Sales Module**: Standard floating-point Indian Rupees (`rate`, `cgst_rate`, `subtotal`, `grand_total`).
   - **Purchase Module**: High-precision integer Paise / Milli-rupees (`weight_g` in integer grams, `rate_milli` in milli-rupees/kg, `amount_paise`, `kacha_due_paise`, `gst_due_paise`). **NEVER convert purchase math to floats.**
3. **Database Migration Safety**: Never edit or renumber existing migration files in `pb_migrations/`. PocketBase executes migrations strictly in chronological order by timestamp prefix.
4. **Soft-Delete vs Hard-Delete Policy**:
   - **Parties (Customers & Suppliers)**: Never hard-deleted. They are deactivated (`active: false`) to preserve accounting and tax ledger integrity.
   - **Items**: Delete is blocked if referenced in any historical bill or session. Only unreferenced items can be hard-deleted.
5. **Windows Production Host**: Production executes on Windows using PowerShell daemon scripts (`windows/start-kapil.ps1`, `windows/backup-kapil.ps1`). Linux is the secondary development environment.
6. **Zero-Regression Verification**: Every change must pass `npm run verify` (0 TypeScript errors, 468+ Vitest unit tests passing, clean Vite build).

---

## 2. Declutter Status Classification Badges

Every file and directory in this guide is categorized using one of these 5 action badges:

| Badge | Meaning | Action for Incoming Agent |
| :--- | :--- | :--- |
| 🟢 `[KEEP - CORE]` | Active production application code. | Keep intact. Only touch for feature work or visual polish. |
| 🔒 `[KEEP - INVARIANT]` | DB migrations, runtime config, financial formulas. | Strict safety; never alter or delete casually. |
| 🔴 `[PRUNE - SAFE DELETE]` | Dead code, 0-usage UI components, orphaned scratch scripts. | **Safe to delete immediately.** |
| 📦 `[ARCHIVE]` | Historical audit notes, old agent worklogs, legacy seeds. | Move to `archive/` or delete to remove cognitive noise. |
| 🔄 `[CONSOLIDATE]` | Duplicated logic, old redirect stubs, parallel patterns. | Refactor or merge into unified modules. |

---

## 3. Root Directory File-by-File Breakdown (36 Files)

| File | Size | Status | Purpose & Description | Declutter Action & Rationale |
| :--- | :---: | :---: | :--- | :--- |
| `.env` | 731 B | 🔒 `[KEEP - INVARIANT]` | Local development environment configuration (`VITE_POCKETBASE_URL`, port). | Keep local development configuration. |
| `.env.example` | 1.6 KB | 🟢 `[KEEP - CORE]` | Template documenting required environment variables. | Keep as reference. |
| `.env.smoke` | 58 B | 📦 `[ARCHIVE]` | Environment overrides for legacy smoke scripts. | Move to `scripts/` or archive if unused. |
| `.env.windows.example` | 180 B | 🔒 `[KEEP - INVARIANT]` | Template for Windows production runtime environment. | Keep for Windows deployments. |
| `.gitignore` | 787 B | 🔒 `[KEEP - INVARIANT]` | Git ignore rules (`node_modules`, `dist`, `.env`, `runtime/data`). | Keep untouched. |
| `AGENTS.md` | 5.7 KB | 🔒 `[KEEP - INVARIANT]` | System-level harness rules for Arch Linux / CachyOS workstation. | Keep as primary environment guide. |
| `CLAUDE.md` | 7.6 KB | 🔒 `[KEEP - INVARIANT]` | Master developer command guide and architectural invariants. | Keep as active AI developer guide. |
| `Caddyfile` | 1.8 KB | 🟢 `[KEEP - CORE]` | Web server config for reverse proxying frontend & PocketBase. | Keep active for local preview serving. |
| `DATABASE-RUNBOOK.md` | 2.8 KB | 🟢 `[KEEP - CORE]` | PocketBase SQLite backup, restore, and WAL integrity manual. | Keep in root or move to `docs/operations/`. |
| `MUSE_BUSINESS_LOGIC_AND_RULES.md` | 8.1 KB | 📦 `[ARCHIVE]` | Early Muse agent spec on business rules (superseded by `CLAUDE.md`). | Move to `docs/architecture/historical-muse/`. |
| `MUSE_INTEGRATION_GUIDE.md` | 4.2 KB | 📦 `[ARCHIVE]` | Integration notes for external Muse tools. | Move to `docs/architecture/historical-muse/`. |
| `MUSE_ONBOARDING_PROMPT.md` | 11.5 KB | 📦 `[ARCHIVE]` | Historical onboarding prompt for past LLM sessions. | Move to `docs/architecture/historical-muse/`. |
| `MUSE_SYNC_BRIEFING_2026-10-25.md` | 9.2 KB | 📦 `[ARCHIVE]` | Time-stamped progress brief from October 2026. | Move to `docs/operations/audits/`. |
| `MUSE_SYSTEM_PROMPT.md` | 13.6 KB | 📦 `[ARCHIVE]` | System prompt used for earlier Muse sessions. | Move to `docs/architecture/historical-muse/`. |
| `PRODUCT.md` | 1.8 KB | 🟢 `[KEEP - CORE]` | High-level product summary and feature overview. | Keep as brief product spec. |
| `PURCHASE-MODULE-AUDIT-AND-CHANGES.md` | 9.3 KB | 📦 `[ARCHIVE]` | Detailed audit of purchase module refactor from Nov 7, 2026. | Move to `docs/operations/audits/`. |
| `README.md` | 5.7 KB | 🟢 `[KEEP - CORE]` | Standard repository entry point and developer instructions. | Keep active. |
| `TROUBLESHOOTING.md` | 2.4 KB | 🟢 `[KEEP - CORE]` | Common error resolutions for PocketBase, ports, and Caddy. | Keep in root or move to `docs/operations/`. |
| `WINDOWS-LOCAL-HANDOFF.md` | 15.5 KB | 🟢 `[KEEP - CORE]` | Production handoff instructions for running on the Windows PC. | Keep active. |
| `WINDOWS-SETUP.md` | 3.4 KB | 🟢 `[KEEP - CORE]` | Initial Windows setup and dependency installation instructions. | Keep active. |
| `code.gs` | 47.3 KB | 📦 `[ARCHIVE]` | Legacy Google Apps Script from before PocketBase migration. | Move to `archive/legacy-google-sheets/`. |
| `codebase-tree.txt` | 39.0 KB | 📦 `[ARCHIVE]` | ASCII directory tree snapshot generated for context briefing. | Temporary scratchpad; safe to delete or archive. |
| `components.json` | 516 B | 🟢 `[KEEP - CORE]` | Shadcn UI configuration file. | Keep active for UI generator tools. |
| `cursor_project_scope_and_organization_d.md` | 124.8 KB | 🔴 `[PRUNE - SAFE DELETE]` | Massive early prompt dump from Cursor; 100% superseded by `docs/`. | **Delete to free 125 KB of cognitive overhead.** |
| `eslint.config.js` | 1.7 KB | 🟢 `[KEEP - CORE]` | Linter configuration. | Keep active. |
| `favicon.png` | 1.5 MB | 🔴 `[PRUNE - SAFE DELETE]` | Huge 1.5 MB image stored directly in root (production uses `public/`). | **Delete from root**; use optimized assets in `public/`. |
| `index.html` | 532 B | 🟢 `[KEEP - CORE]` | HTML shell for Vite application. | Keep untouched. |
| `package.json` | 2.9 KB | 🔒 `[KEEP - INVARIANT]` | NPM dependencies and build/test/verify script commands. | Keep untouched. |
| `package-lock.json` | 636.9 KB | 🔒 `[KEEP - INVARIANT]` | Dependency lockfile. | Keep untouched. |
| `tsconfig.app.json` | 641 B | 🔒 `[KEEP - INVARIANT]` | TypeScript app configuration. | Keep untouched. |
| `tsconfig.json` | 193 B | 🔒 `[KEEP - INVARIANT]` | Root TypeScript project reference configuration. | Keep untouched. |
| `tsconfig.node.json` | 591 B | 🔒 `[KEEP - INVARIANT]` | TypeScript Node environment configuration. | Keep untouched. |
| `unfinished_favicon.png` | 943.1 KB | 🔴 `[PRUNE - SAFE DELETE]` | 1 MB unoptimized scratch favicon file sitting in project root. | **Delete immediately.** |
| `update-2026-09-19-quick-payment-bill-attachment.md` | 8.7 KB | 📦 `[ARCHIVE]` | Historical changelog from September 2026. | Move to `docs/operations/audits/`. |
| `update-2026-11-04-supplier-purchase-redesign.md` | 5.7 KB | 📦 `[ARCHIVE]` | Historical changelog from November 4, 2026. | Move to `docs/operations/audits/`. |
| `vite.config.ts` | 4.7 KB | 🔒 `[KEEP - INVARIANT]` | Vite build config with PocketBase & Telegram RSS proxy middleware. | Keep untouched. |

---

## 4. Agent Workspaces, Scratch & Legacy Dumps

| Directory / File | Size | Status | Purpose & Description | Declutter Action & Rationale |
| :--- | :---: | :---: | :--- | :--- |
| `AgentRouterWork/` | 16 files | 📦 `[ARCHIVE]` | Scratch plans, worklogs, screenshots, and regression scripts left by previous AI agents during the Nov 7-8 purchase fix. | **Move entire folder to `archive/agent-work-2026-11/` or delete screenshots to free repo size.** |
| `.codeman-uploads/` | 1 file | 🔴 `[PRUNE - SAFE DELETE]` | Contains `paste-1794169213628-c7153f41-kapil-restructure-build-plan.md` (duplicate of `docs/features/kapil-restructure-build-plan.md`). | **Delete folder immediately.** |
| `database-transfer/` | 34.2 MB | 📦 `[ARCHIVE]` | Contains `kapil-production-20260804.zip.enc` (encrypted snapshot from Aug 2026). | Keep if offline recovery is needed, but exclude from git commits. |
| `archive/demo/demo/` | 200+ files | 🔴 `[PRUNE - SAFE DELETE]` | **CRITICAL:** A nested, duplicate clone of the entire old project. Vitest currently scans and executes test files inside here! | **Delete `archive/demo/demo/` or exclude `archive/**` in `vite.config.ts` to stop running obsolete tests.** |
| `automation/` | 1 file | 🟢 `[KEEP - CORE]` | Contains `Sync-KapilToGoogleSheet.ps1` for Google Sheets backup automation. | Keep active for Windows automation. |

---

## 5. Scripts Directory Breakdown (`scripts/`)

| File / Subfolder | Size | Status | Category | Purpose & Recommended Action |
| :--- | :---: | :---: | :--- | :--- |
| `linux/` | ~15 KB | 🟢 `[KEEP - CORE]` | Operational | Linux start, stop, backup (`backup-kapil.sh`), and health check scripts. Keep active. |
| `create-backup.mjs` | 3.4 KB | 🟢 `[KEEP - CORE]` | Operational | Programmatic PocketBase database backup creator. Keep active. |
| `add-missing-indexes.mjs` | 4.1 KB | 📦 `[ARCHIVE]` | Historical DB | One-time index migration script (already incorporated into `pb_migrations/`). |
| `apply-bill-number-guards.mjs` | 4.5 KB | 📦 `[ARCHIVE]` | Historical DB | Script enforcing bill number sequence rules. Archive to `scripts/historical/`. |
| `backfill-bags-from-qty.mjs` | 1.2 KB | 📦 `[ARCHIVE]` | One-off Fix | Backfilled bag counts from legacy quantities. Archive to `scripts/historical/`. |
| `backfill-created-updated-sqlite.py` | 1.6 KB | 📦 `[ARCHIVE]` | One-off Fix | Python SQLite script to backfill timestamp fields. Archive to `scripts/historical/`. |
| `ensure-casting-collections.mjs` | 7.8 KB | 📦 `[ARCHIVE]` | Historical DB | Standalone schema creator before formal `pb_migrations/`. Archive. |
| `ensure-customers-company-name.mjs` | 2.4 KB | 📦 `[ARCHIVE]` | Historical DB | Schema validator for company name field. Archive. |
| `ensure-payment-drafts-collection.mjs`| 4.7 KB | 📦 `[ARCHIVE]` | Historical DB | Schema creator for payment drafts. Archive. |
| `ensure-stock-collections.mjs` | 12.2 KB | 📦 `[ARCHIVE]` | Historical DB | Schema creator for inventory collections. Archive. |
| `fix-brass-rates-api-rules.mjs` | 1.4 KB | 📦 `[ARCHIVE]` | Historical DB | API rule patcher for market rate collections. Archive. |
| `import-brass-rates.mjs` | 3.9 KB | 🟢 `[KEEP - CORE]` | Utility | Imports historical brass rates into PocketBase. Keep. |
| `import-legacy-and-fake.mjs` | 12.7 KB | 📦 `[ARCHIVE]` | One-off Seed | Seeded mock legacy data for initial testing. Archive. |
| `import-opening-balances.mjs` | 5.2 KB | 📦 `[ARCHIVE]` | One-off Seed | Imported initial customer opening balances. Archive. |
| `seed-large-demo.mjs` | 13.0 KB | 🟢 `[KEEP - CORE]` | Dev / Demo | Populates local PocketBase with large realistic demo dataset. Keep. |
| `seed-purchase-demo.mjs` | 17.3 KB | 🟢 `[KEEP - CORE]` | Dev / Demo | Populates purchase suppliers, bills, and payments demo data. Keep. |
| `normalize-purchase-items.mjs` | 4.3 KB | 🟢 `[KEEP - CORE]` | Utility | Normalizes purchase item names and references. Keep. |
| `brass-bulletin.mjs` | 11.3 KB | 🟢 `[KEEP - CORE]` | Brass Market | Scrapes and formats daily Jamnagar brass market bulletins. Keep. |
| `brass-bulletin.test.mjs` | 5.5 KB | 🟢 `[KEEP - CORE]` | Test | Vitest unit tests for brass bulletin parser. Keep. |
| `brass-localhub.mjs` | 2.4 KB | 🟢 `[KEEP - CORE]` | Integration | Bridge connecting market rates to LocalHub service monitor. Keep. |
| `brass-rates-schema.mjs` | 2.8 KB | 🟢 `[KEEP - CORE]` | Brass Market | Rate schema definitions. Keep. |
| `brass-rss-daemon.mjs` | 3.8 KB | 🟢 `[KEEP - CORE]` | Daemon | Background worker polling Telegram RSS feed for market price updates. Keep. |
| `brass-rss-watch.mjs` | 9.6 KB | 🟢 `[KEEP - CORE]` | Daemon | File watcher & rate alert generator. Keep. |
| `brass-weekly-report.mjs` | 5.7 KB | 🟢 `[KEEP - CORE]` | Report | Generates weekly brass price fluctuation summaries. Keep. |
| `build-pdf-fonts.py` | 3.7 KB | 🟢 `[KEEP - CORE]` | Build Utility | Converts TTF font files into binary JS strings for PDF engine. Keep. |
| `audit-purchase-pages.mjs` | 1.5 KB | 🔴 `[PRUNE - SAFE DELETE]` | Scratch Audit | One-off Playwright audit script from Nov 7. Safe to delete. |
| `audit-purchase-interactions.mjs`| 3.0 KB | 🔴 `[PRUNE - SAFE DELETE]` | Scratch Audit | One-off interaction test script. Safe to delete. |
| `capture_verification_pages.mjs` | 1.4 KB | 🔴 `[PRUNE - SAFE DELETE]` | Scratch Capture | Headless screenshot capture script used during testing. Safe to delete. |
| `capture_purchase_items.mjs` | 2.1 KB | 🔴 `[PRUNE - SAFE DELETE]` | Scratch Capture | Screenshot capture script. Safe to delete. |
| `capture_unified_items.mjs` | 2.0 KB | 🔴 `[PRUNE - SAFE DELETE]` | Scratch Capture | Screenshot capture script. Safe to delete. |
| `perf-cold-load.mjs` | 2.2 KB | 🟢 `[KEEP - CORE]` | Benchmark | Measures cold load times and TTFB for large bills. Keep. |
| `smoke-auth.mjs` | 2.2 KB | 🟢 `[KEEP - CORE]` | Test | CLI auth verification script. Keep. |
| `smoke-ui.mjs` | 1.6 KB | 🟢 `[KEEP - CORE]` | Test | CLI page routing smoke check. Keep. |
| `smoke-ui-interactions.mjs` | 4.7 KB | 🟢 `[KEEP - CORE]` | Test | CLI user interaction smoke test. Keep. |
| `telegram-session.mjs` | 2.9 KB | 🟢 `[KEEP - CORE]` | Utility | Authenticates Telegram session for rate scraping. Keep. |
| `verify-restoration.mjs` | 3.1 KB | 🟢 `[KEEP - CORE]` | Utility | Verifies data integrity after a database restore. Keep. |

---

## 6. Documentation Directory Breakdown (`docs/`)

```
docs/
├── README.md                                          # Entry point for docs
├── architecture/
│   ├── AI-CONTEXT.md                                  # Comprehensive architectural briefing for AI agents
│   └── project-architecture-and-data-flow.md          # Visual dataflow and subsystem diagrams
├── features/
│   ├── ui-system-audit.md                             # 153-line complete UI/UX & component audit
│   ├── system-map.md                                  # 133-line full system architectural map
│   ├── kapil-restructure-build-plan.md                # Master restructuring roadmap (Phase 1-8)
│   ├── restructure-plan.md                            # High-level goals for unified items & party ledger
│   ├── restructure-progress.md                        # Active tracking checklist of completed items
│   ├── billing-system-explained.md                    # Detailed domain explanation of billing formulas
│   ├── procurement-casting-sales-workflow.md          # Factory operational lifecycle narrative
│   ├── keyboard-first-new-bill-and-payment.md         # Hotkey standards (Enter, Alt+S, Esc)
│   ├── company-report-page-notes.md                   # Legacy notes on monthly financial report
│   ├── new-bill-page-notes.md                         # Legacy notes on sales bill entry
│   ├── new-customers-page-notes.md                    # Legacy notes on customer creation
│   ├── new-payment-page-notes.md                      # Legacy notes on sales payment entry
│   └── party-ledger-page-notes.md                     # Legacy notes on customer ledger table
├── operations/
│   ├── audits/                                        # Historical operational reviews & memory audits
│   ├── deploy/                                        # Nginx configs & reverse proxy docs
│   ├── doppler-secrets.md                             # Secrets management reference
│   ├── incident-notes.md                              # Historical incident logs
│   ├── pocketbase-disaster-recovery.md                # Emergency restoration runbook
│   └── security-auth-setup.md                         # Admin auth policies
└── superpowers/                                       # 13 legacy plan & spec files from May–Aug 2026
```

> **Declutter Recommendation for `docs/`:**
> - Keep `docs/architecture/` and `docs/features/` active. They contain live restructuring plans.
> - Move legacy notes (`company-report-page-notes.md`, `new-customers-page-notes.md`, etc.) and `docs/superpowers/` into `archive/docs/` to keep active documentation focused.

---

## 7. Application Source Code (`src/`)

### 7.1 Routes (`src/routes/` — 41 Routes)

| Route Path / File | Status | Purpose | Routing Notes & Consolidation Strategy |
| :--- | :---: | :--- | :--- |
| `__root.tsx` | 🟢 `[KEEP - CORE]` | Root layout shell. Renders `AppShell` with nav rail, breadcrumbs, search. | Core router entry point. |
| `index.tsx` | 🟢 `[KEEP - CORE]` | **Main Business Dashboard**. Month picker, Sales vs Collections, dues, alerts. | Primary landing page (`/`). |
| `new-bill.tsx` | 🟢 `[KEEP - CORE]` | **Sales Bill Entry Form**. Keyboard-first, rapid line addition, autosave draft. | Active core sales flow. |
| `new-payment.tsx` | 🟢 `[KEEP - CORE]` | **Sales Payment Entry Form**. Customer selection, settlement allocation. | Active core sales flow. |
| `print-bill.tsx` | 🟢 `[KEEP - CORE]` | Printable Sales Bill / Invoice view with print layout engine. | Core invoice output. |
| `items.tsx` | 🟢 `[KEEP - CORE]` | **Unified Items Hub**. 3 tabs: Sale Items, Purchase Items, Casting Items. | **Replaces all individual item pages.** |
| `purchase-items.tsx` | 🔄 `[CONSOLIDATE]` | Old Purchase Items route (21 lines). | **Redirects to `/items?tab=purchase`. Safe to keep as redirect or prune.** |
| `casting/materials.tsx`| 🔄 `[CONSOLIDATE]` | Old Casting Materials route (5 lines). | **Redirects to `/items?tab=casting`. Safe to keep as redirect or prune.** |
| `ledger.tsx` | 🟢 `[KEEP - CORE]` | **Unified Party Ledger Hub**. 2 tabs: Customers, Suppliers. Split khata. | **Replaces old `/customers` and `/suppliers`.** |
| `customers.tsx` | 🔄 `[CONSOLIDATE]` | Old Customers route (527 lines). Line 17 redirects to `/ledger?tab=customers`. | **Dead code alert:** Contains 510 lines of unreachable JSX. Can be trimmed to a clean redirect. |
| `suppliers.tsx` | 🔄 `[CONSOLIDATE]` | Old Suppliers route (153 lines). Line 30 redirects to `/ledger?tab=suppliers`. | **Dead code alert:** Contains 120 lines of unreachable JSX. Can be trimmed to a clean redirect. |
| `supplier-payments.tsx`| 🔄 `[CONSOLIDATE]` | Old Supplier Payments route (28 lines). | **Redirects to `/purchase-bills?view=payments`.** |
| `bardan-pending.tsx` | 🔄 `[CONSOLIDATE]` | Old Bardan Pending route (9 lines). | **Redirects to `/purchase-bills?tab=bardan`.** |
| `purchase-bills/index.tsx` | 🟢 `[KEEP - CORE]` | Purchase Hub (Bills list, Payments list, Bardan tracking). | Core purchase operations. |
| `purchase-bills/$billId.tsx`| 🟢 `[KEEP - CORE]` | Purchase Bill Detail / Edit view. | Core purchase operations. |
| `new-purchase-bill.tsx`| 🟢 `[KEEP - CORE]` | **Purchase Bill Entry Form**. Weight, rate/kg, Mkt Δ, bags, Chitty preview. | Core purchase workflow. |
| `new-supplier-payment.tsx` | 🟢 `[KEEP - CORE]` | **Supplier Payment Entry Form**. Dual pool (Kacha/GST), mode, notes. | Core purchase workflow. |
| `print-purchase-bills.tsx` | 🟢 `[KEEP - CORE]` | Purchase Chitty bulk & single print view. | Core purchase output. |
| `supplier-ledger.$supplierId.tsx` | 🟢 `[KEEP - CORE]` | Detailed ledger for single supplier. Dual pool balance, statement export. | Core supplier khata. |
| `purchase-dashboard.tsx`| 🟢 `[KEEP - CORE]` | Purchase Sub-Dashboard. Today strip, spend trend, material matrix. | Purchase module overview. |
| `purchase-logs.tsx` | 🟢 `[KEEP - CORE]` | Raw transaction logs for all purchase operations. | Purchase auditing. |
| `sales-dashboard.tsx` | 🟢 `[KEEP - CORE]` | Sales Sub-Dashboard. Receivable ageing, top items, trend charts. | Sales module overview. |
| `casting/index.tsx` | 🟢 `[KEEP - CORE]` | Casting Module Hub. Foundry runs, metal balance, crucible stats. | Casting home. |
| `casting/new-session.tsx`| 🟢 `[KEEP - CORE]` | New Casting Melting Session entry form. Ingot inputs vs wire output. | Casting session creator. |
| `casting/log.tsx` | 🟢 `[KEEP - CORE]` | Casting session historical log and yield calculation table. | Casting logbook. |
| `casting/bill.tsx` | 🟢 `[KEEP - CORE]` | Casting Job-Work Bill generator for outside foundry clients. | Casting billing. |
| `casting.tsx` | 🔄 `[CONSOLIDATE]` | Old root casting redirect stub (redirects to `/casting`). | Harmless stub. |
| `transactions.tsx` | 🟢 `[KEEP - CORE]` | Combined Sales transaction logs (Bills + Payments + Dues). | Sales transaction audit. |
| `drafts.tsx` | 🟢 `[KEEP - CORE]` | Bill and Payment drafts table with quick approve/reject actions. | Draft processing. |
| `monthly-report.tsx` | 🟢 `[KEEP - CORE]` | High-level monthly company financial report and year-to-date metrics. | Executive reporting. |
| `monthly-sales-calendar.tsx`| 🟢 `[KEEP - CORE]` | Daily sales calendar with heatmap and quick day breakdown. | Visual sales tracker. |
| `calendar.tsx` | 🔄 `[CONSOLIDATE]` | Calendar redirect stub (redirects to `/monthly-sales-calendar`). | Harmless stub. |
| `reports/sales.tsx` | 🟢 `[KEEP - CORE]` | Dedicated Sales analytics report. | Report view. |
| `reports/purchase.tsx` | 🟢 `[KEEP - CORE]` | Dedicated Purchase analytics report. | Report view. |
| `reports/casting.tsx` | 🟢 `[KEEP - CORE]` | Dedicated Casting efficiency and yield report. | Report view. |
| `export-reports.tsx` | 🟢 `[KEEP - CORE]` | Data export studio (PDF, Excel XLSX, ZIP bundles of ledgers). | Critical financial exports. |
| `settings.tsx` | 🟢 `[KEEP - CORE]` | Module toggles (Enable/Disable Purchase & Casting), firm profile. | App configuration. |
| `data-health.tsx` | 🟢 `[KEEP - CORE]` | Database integrity diagnostics (broken references, missing balances). | Admin diagnostics. |
| `control-room.tsx` | 🟢 `[KEEP - CORE]` | Administrative operations control center. | Super-user console. |
| `backup.tsx` | 🟢 `[KEEP - CORE]` | PocketBase snapshot trigger and restore UI. | Database safety. |
| `issues.tsx` | 🟢 `[KEEP - CORE]` | System error tracking and alert log. | Error diagnostics. |
| `dev/components.tsx` | 🟢 `[KEEP - CORE]` | Design system component gallery / playground. | Internal developer UI test. |

---

### 7.2 UI Components Inventory (`src/components/ui/` — 30 Files)

We performed a strict import dependency analysis across all files. Here are the exact findings:

#### 🔴 The 9 Zero-Import Primitives (Ready to Prune)
These components were generated by shadcn/ui but have **ZERO imports** anywhere in the codebase:
1. `command.tsx` (0 usages — command palette uses custom keyboard handling in `src/lib/commands.ts`).
2. `dropdown-menu.tsx` (0 usages).
3. `form-field.tsx` (0 usages).
4. `page-header.tsx` (0 usages).
5. `section-header.tsx` (0 usages).
6. `select.tsx` (0 usages).
7. `stat-tile.tsx` (0 usages).
8. `table.tsx` (0 usages — tables use raw Tailwind styling).
9. `tooltip.tsx` (0 usages).

#### ⚠️ Secondary Unused Primitives
These primitives are only imported by other dead primitives or self-tests:
- `button.tsx` (Only imported by `alert-dialog.tsx`, `dialog.tsx`, and `input-group.tsx`).
- `input.tsx` (Only imported by `input-group.tsx` and `command.tsx`).
- `textarea.tsx` (Only imported by `input-group.tsx`).
- `input-group.tsx` (Only imported by `command.tsx`).

#### 🟢 The Active Core Primitives (DO NOT TOUCH)
- `confirm-dialog.tsx`: Standard modal for delete and discard confirmations (used across items and casting).
- `date-input.tsx`: Standardized calendar input with keyboard shortcuts.
- `payment-amount-input.tsx`: Currency input with live Indian grouping and quick denominations.
- `searchable-combobox.tsx`: Autocomplete selector used for customers, suppliers, and items.
- `sonner.tsx`: Toast notification provider.
- `panel.tsx`: Card shell component (`rounded-xl border border-slate-200 bg-white p-4 shadow-sm`).
- `money-cell.tsx`: Monospace tabular Indian Rupee formatter.
- `status-chip.tsx`: Clean pill badge for Kacha/GST pools, bill status, and bardan state.
- `form-control-classes.ts`: The unified single source of truth for input heights and focus rings (`inputClass`, `selectClass`).
- `business-kit.tsx`: Unified design kit aggregating standard card, header, and button styles.

---

### 7.3 Feature Components (`src/components/`)

| Folder | Active Files | Purpose & Critical Roles |
| :--- | :--- | :--- |
| `billing/` | `bill-print-layout.tsx`, `bill-print-styles.ts`, `bill-print.css` | Print layout and CSS media print rules for tax invoices. |
| `calendar/` | `calendar-day-sidebar.tsx`, `calendar-month-overview.tsx`, `gas-selling-strip.tsx` | Heatmap calendar visualizers and daily sales summaries. |
| `exports/` | `party-statement-hero.tsx`, `party-statement-preview.tsx`, `more-exports-panel.tsx` | Party statement generation and export previews. |
| `items/` | `casting-items-view.tsx` | Specialized CRUD view for casting metals and flux materials. |
| `ledger/` | `party-list-panel.tsx`, `party-trend-chart.tsx` | Master list rail for customer/supplier khata and balance trend graph. |
| `purchase-dashboard/` | `today-strip.tsx`, `spend-trend.tsx`, `material-matrix.tsx`, `pay-next.tsx`, `recent-feeds.tsx`, `snapshot-tiles.tsx` | Visual KPI blocks for the purchase sub-dashboard. |
| `reports/` | `company-charts.tsx`, `report-table.tsx` | Recharts wrappers for monthly sales, collection curves, and tabular aggregates. |
| `suppliers/` | `bill-chitty.tsx`, `bill-modals.tsx`, `purchase-bills-table.tsx`, `supplier-payments-table.tsx`, `supplier-form-modal.tsx`, `supplier-list-panel.tsx`, `purchases-shell.tsx` | Core purchase components: bill entry modals, dual-pool tables, and physical chitty rendering. |
| `transactions/` | `transaction-editor-host.tsx`, `transaction-editor-events.ts` | Sales transaction editor modal. |
| `layout/` | `app-shell.tsx`, `sidebar-nav.tsx`, `quick-search-preview.tsx`, `focus-layout.tsx` | Global navigation shell, collapsible sidebar, Ctrl+K quick search. |
| `auth/` | `login-screen.tsx` | PocketBase admin login interface. |

---

### 7.4 Domain & Data Layers (`src/domain/` & `src/data/`)

These directories contain the business mathematics, PocketBase client queries, and validation schemas. **Handle with extreme care.**

| Critical Module | Primary Responsibility | Key Invariant |
| :--- | :--- | :--- |
| `src/domain/bill-books.ts` | Sales bill numbering, book sequences (Regular vs Tax). | Financial integrity. |
| `src/domain/supplier-settlement.ts` | FIFO settlement of supplier purchase bills against payments & advance credits. | Integer paise arithmetic only. |
| `src/domain/supplier-ledger.ts` | Running balance computation for dual Kacha & GST pools. | Preserves opening balances. |
| `src/domain/supplier-units.ts` | Conversions: Grams $\leftrightarrow$ Kg, Milli-rupees $\leftrightarrow$ Rupees, Paise $\leftrightarrow$ Rupees. | Never round floating point midway. |
| `src/domain/financial-math.ts` | Sales subtotal, CGST, SGST, rounding, grand total. | Float rupees math with standard half-up rounding. |
| `src/data/module-settings.ts` | Syncs `app_settings` collection (`purchase_enabled`, `casting_enabled`) with PocketBase. | Shared across all devices. |
| `src/data/pocketbase.ts` | PocketBase client singleton and collection helpers. | Base data gateway. |
| `src/lib/inr-format.ts` | Indian numbering system formatter (`₹1,23,456.78`). | Client display standard. |
| `src/lib/commands.ts` | Global Ctrl+K command palette registry and navigation hooks. | Fast keyboard navigation. |

---

## 8. PocketBase Database & Migrations (`pb_migrations/`)

- The live database schema is managed via PocketBase migration files in `pb_migrations/`.
- **Absolute Rule:** Never delete or alter existing migrations. PocketBase tracks applied migrations by filename. Modifying an existing migration causes migration failure on the live Windows host.
- Recent key migrations:
  - `1794640004_created_app_settings.js`: Persistent database-backed module toggle store.
  - `1794640004_setup_supplier_purchase_rules.js`: Purchase module API access rules.
  - `1794640006_created_casting_items.js`: Dedicated casting items table.

---

## 9. Windows Host Tooling (`windows/`)

Files in `windows/` automate the system on the client's physical Windows PC:
- `start-kapil.ps1`: Starts PocketBase and Caddy in the background.
- `stop-kapil.ps1`: Gracefully terminates running background daemons.
- `backup-kapil.ps1`: Compresses SQLite database into timestamped `.zip` backup before updates.
- `restore-kapil.ps1`: Restores database from a chosen backup file.
- `setup.ps1` & `install-tasks.ps1`: Registers Windows Task Scheduler jobs for autostart on system boot.

---

## 10. Prioritized 5-Phase Decluttering Playbook

Follow this step-by-step roadmap to declutter the codebase safely:

### Phase 1: Zero-Risk Dead Asset & File Pruning
1. Delete `cursor_project_scope_and_organization_d.md` (125 KB dead dump in root).
2. Delete root unoptimized image files: `unfinished_favicon.png` (943 KB) and `favicon.png` (1.5 MB).
3. Delete `.codeman-uploads/` directory.
4. Delete scratch audit scripts in `scripts/`: `audit-purchase-pages.mjs`, `audit-purchase-interactions.mjs`, `capture_verification_pages.mjs`, `capture_purchase_items.mjs`, `capture_unified_items.mjs`.

### Phase 2: Agent Work & Archive Cleanup
1. Move or purge `AgentRouterWork/` (16 temporary agent logs and screenshots).
2. Exclude `archive/**` from Vitest in `vite.config.ts`, or delete `archive/demo/demo/` (stops running duplicate tests from old clones).
3. Consolidate one-off backfill scripts in `scripts/` into `scripts/historical/`.

### Phase 3: Dead UI Primitive Pruning
1. Remove the 9 zero-usage primitives in `src/components/ui/`: `command.tsx`, `dropdown-menu.tsx`, `form-field.tsx`, `page-header.tsx`, `section-header.tsx`, `select.tsx`, `stat-tile.tsx`, `table.tsx`, `tooltip.tsx`.
2. Inspect `button.tsx`, `input.tsx`, `textarea.tsx`, `input-group.tsx` and safely remove them once references in dead dialog wrappers are cleaned.

### Phase 4: Route Redirect Stub Streamlining
1. Open `src/routes/customers.tsx`: It redirects to `/ledger` on line 17. Trim the 510 lines of unreachable dead component code down to a clean, lightweight redirect.
2. Open `src/routes/suppliers.tsx`: It redirects to `/ledger` on line 30. Trim the 120 lines of unreachable dead component code down to a clean, lightweight redirect.

### Phase 5: Verification & Safety Check
Run the complete test and build pipeline after each phase:
```bash
npm run verify
```
Ensure all 468+ tests pass, typecheck produces 0 errors, and the production Vite bundle builds cleanly.
