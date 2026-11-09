# Declutter Inventory & Verification (Step 1)
Date: 2026-11-09 | Host: Arch/Windows Local-Primary | Status: Verified

## 1. Scanner & Tracked Files Verification
- **vitest**: SCANS `archive/**` (runs 3 test suites: ledger, customers, billing-calc in `archive/demo/demo`).
- **tsc**: DOES NOT scan `archive/**` (`include: ["src"]` in `tsconfig.app.json`).
- **eslint**: DOES NOT scan `archive/**` (`globalIgnores(["archive/**", ...])` in `eslint.config.js`).
- **knip**: SCANS `archive/**` by default (reports 143 unused files in archive).
- **Tracked in Git**: `.impeccable/live/config.json` (TRACKED), `database-transfer/kapil-production-20260804.zip.enc` (TRACKED - 34MB).
- **Untracked in Git**: `.codeman-uploads/` (UNTRACKED), `.tanstack/` (UNTRACKED), `.agents/` (UNTRACKED).

## 2. Key Target References
- `MUSE_*.md` (5 files): Referenced ONLY internally by each other (`MUSE_ONBOARDING_PROMPT.md`, `MUSE_SYNC_BRIEFING_2026-10-25.md`). No runtime code references them. Potential external Muse agent reads.
- `code.gs`: Referenced ONLY inside `archive/` (historical docs). Zero runtime or automation references.
- `.env.smoke`: Referenced in `scripts/smoke-auth.mjs:6` (`readFileSync("../.env.smoke")`). ACTIVE reference.
- `cursor_project_scope_and_organization_d.md`: Referenced in `README.md:41,141` and `CLAUDE.md:164`.

## 3. Scripts Referrers Summary (35 scripts)
- **0 external refs (safe candidates)**: `add-missing-indexes.mjs`, `audit-purchase-interactions.mjs`, `audit-purchase-pages.mjs`, `capture_purchase_items.mjs`, `capture_unified_items.mjs`, `capture_verification_pages.mjs`, `ensure-customers-company-name.mjs`, `ensure-payment-drafts-collection.mjs`, `ensure-stock-collections.mjs`, `fix-brass-rates-api-rules.mjs`, `perf-cold-load.mjs`, `telegram-session.mjs`, `verify-restoration.mjs`.
- **Referenced in package.json/runtime**: `brass-rss-daemon.mjs`, `brass-rss-watch.mjs`, `brass-weekly-report.mjs`, `seed-large-demo.mjs`, `seed-purchase-demo.mjs`, `smoke-ui-interactions.mjs`.
- **Referenced in docs/README**: `apply-bill-number-guards.mjs`, `backfill-bags-from-qty.mjs`, `import-brass-rates.mjs`, `import-legacy-and-fake.mjs`, `import-opening-balances.mjs`, `ensure-casting-collections.mjs`.
- **Referenced in code/tests**: `build-pdf-fonts.py` (`pdf-fonts.ts`), `brass-bulletin.mjs` (`brass-bulletin.test.mjs`), `create-backup.mjs` (`ensure-payment-drafts-collection.mjs`), `smoke-auth.mjs` (smoke scripts).

## 4. Documentation Contradictions vs Current Code
- `docs/features/procurement-casting-sales-workflow.md`: Describes Buying as placeholder shell; describes dropped Scrap Buying design.
- `docs/features/new-customers-page-notes.md`: Describes standalone `/customers` CRUD (now unified under `/ledger?tab=customers`).
- `docs/features/party-ledger-page-notes.md`: Describes legacy single customer ledger without supplier tabs.
- `docs/features/company-report-page-notes.md` & `new-bill-page-notes.md`: Pre-restructure field and modal layouts.
- `docs/operations/audits/vps-ram-and-restart-audit-2026-04-25.md`: Describes Linux VPS hosting; app is now Windows local-primary.
- `docs/operations/audits/purchase-review-2026-11-07.md`: Pre-dates 2-tab Party Ledger and 3-tab Items consolidation.
- `MUSE_SYNC_BRIEFING_2026-10-25.md`: Describes obsolete ₹30 rule and superseded Muse state.

## 5. PocketBase Migrations Status
- **Local Linux Dev DB (`runtime/data/data.db`)**: 80 on disk, 152 applied in DB. **0 pending migrations**.
- **Windows Production PC Target**: 3 recent migrations will apply on next Windows PocketBase boot:
  1. `1794640004_created_app_settings.js`
  2. `1794640004_setup_supplier_purchase_rules.js`
  3. `1794640006_items_active_and_casting_rules.js` (Note: guide misnamed this `1794640006_created_casting_items.js`).

## 6. Guide Claims Cross-Check & Verification
| Guide Item | Claim | Verified Status | Evidence |
|---|---|---|---|
| Casting items migration | `1794640006_created_casting_items.js` | **WRONG** | Actual file is `1794640006_items_active_and_casting_rules.js` managing `casting_materials`. |
| `MUSE_*.md` | Safe to archive immediately | **UNCERTAIN** | No repo code calls it, but external Muse tool may read path. Needs owner decision. |
| `archive/demo/demo` | Vitest scans it | **CONFIRMED** | Vitest runs 3 test suites inside `archive/demo/demo/src/domain/`. |
| Zero-import UI components | 9 files have 0 imports | **CONFIRMED** | Knip & grep confirm `command`, `dropdown-menu`, `form-field`, `page-header`, `section-header`, `select`, `stat-tile`, `table`, `tooltip` have 0 usages. |
| `cursor_project_scope...` | Safe to delete immediately | **WRONG** | Referenced in `README.md:41,141` and `CLAUDE.md:164`. Links must be cleaned first. |
| `.env.smoke` | Safe to archive | **WRONG** | Required by `scripts/smoke-auth.mjs`. |
| `code.gs` | Used by Google Sheets sync | **WRONG** | Sync script uses internal API; `code.gs` is only in historical text. |
| `database-transfer/*.enc` | Production export in repo | **CONFIRMED** | 34MB file tracked in git. Keep untouched. |

## 7. Master Action Inventory Table
| Path | Kind | References | Action | Confidence |
|---|---|---|---|---|
| `cursor_project_scope_and_organization_d.md` | Doc | README, CLAUDE | Delete (after updating links) | High |
| `favicon.png` & `unfinished_favicon.png` | Assets | Root clutter | Delete (public/ has active icon) | High |
| `.codeman-uploads/` | Scratch | Untracked paste | Delete | High |
| `codebase-tree.txt` | Scratch | 0 | Delete | High |
| `archive/demo/demo/` | Old clone | 3 vitest suites | Delete (or exclude from vitest) | High |
| `AgentRouterWork/` | Agent logs | 0 | Move to `docs/archive/agent-work/` | High |
| `scripts/audit-purchase-*.mjs`, `capture_*.mjs` | Scratch | 0 | Delete | High |
| `scripts/backfill-*.mjs`, `import-*.mjs` | Seed/Fix | README | Keep in `scripts/` (label in README) | High |
| `src/components/ui/` (9 dead primitives) | UI code | 0 (knip/grep) | Delete in Step 5 (after kit lock) | High |
| `src/routes/customers.tsx` & `suppliers.tsx` | Routes | Redirects | Trim dead JSX body to redirect | High |
| `MUSE_*.md` (5 files) | Agent docs | Self | Add warning header; do not move | High |
| `.env.smoke` | Config | `smoke-auth.mjs` | Keep in place | High |
