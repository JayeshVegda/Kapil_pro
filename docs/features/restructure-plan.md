# Kapil Billing three-module restructure — implementation prompt

Status: planning only, 9 November 2026. Owner decisions below. Implement in a later session on a feature branch.

**Machine context:** This checkout and planning session are on Arch Linux. The repository's `AGENTS.md` designates the Windows PC as the sole writable business database. Build and review source here without treating the local Arch runtime as the primary or applying the new migration to live data.

## Decisions

| Question | Decision |
| --- | --- |
| Party Ledger | One screen for customers and suppliers; retain separate collections, balances and ledgers. Never net them per party. |
| Customers page | Move customer create/edit, active status and details into Party Ledger in phase 5. Keep customer statement, PDF/XLSX/ZIP export and ledger drill-down. Remove Customers navigation only when its replacement works. |
| Casting Materials | Show a Casting Materials tab in Items, backed by existing `casting_materials`; retain session usage history. |
| Items and renames | Separate Finished Goods, Raw Materials and Casting Materials tabs. Preserve old casting names as aliases when renaming. |
| Module switches | Purchase and Casting both switchable; one PocketBase setting shared across users. A disabled module hides its UI and blocks direct routes with a clear return path; data remains intact. |
| Main Dashboard | Retain current layout. Sales: due, collected, bills. Purchase: owed, bought, pay next. Casting: melted, output, cost. No combined receivable-minus-payable headline. |
| Purchase payment history | Tab within Purchase Bills; new payment entry remains in Purchase navigation. |
| Reports | Calendar, Company Report, three dedicated module reports, and Exports. Hide disabled modules' data and report links. |
| Names and compatibility | Use “Sale Bills” and “Print Sale Bills”; move AI Drafts above categories; move misleading net buffer off purchase headline. Keep old routes working until their replacement phase adds redirects. |
| Build order | One phase per session: labels/order/AI Drafts → toggles → shared logs shell → dashboards → Party Ledger → Items → reports. |

## Target sidebar

```text
Dashboard                       /
AI Drafts                       /drafts
Party Ledger                    /ledger (customer and supplier tabs/search)
Sales
  Sales Dashboard               /sales-dashboard (new)
  Sale Bills                    /new-bill (existing bill entry; label change)
  Sales Payment                 /new-payment
  Sales Logs                    /transactions
  Print Sale Bills              /print-bill
Purchase [when enabled]
  Purchase Dashboard            /purchase-dashboard
  New Purchase Bill             /new-purchase-bill
  New Purchase Payment          /new-supplier-payment
  Purchase Bills                /purchase-bills (Bills | Payments tabs)
  Purchase Logs                 /purchase-logs
Casting [when enabled]
  Casting Dashboard             /casting
  New Casting Session           /casting/new-session
  Casting Logs                  /casting/log
  Casting Bill                  /casting/bill
Reports
  Calendar                      /monthly-sales-calendar
  Company Report                /monthly-report
  Sales Report                  /reports/sales (new)
  Purchase Report               /reports/purchase (new, when enabled)
  Casting Report                /reports/casting (new, when enabled)
  Exports                       /export-reports
Setup
  Items                         /items (module tabs)
  Issues · Data Health · Backup · Settings (existing routes)
```

## Final implementation prompt for the coding agent

You are implementing the owner-approved three-module restructure in `/home/arch/project/Kapil_pro`. Read `AGENTS.md`, `WINDOWS-SETUP.md`, `DATABASE-RUNBOOK.md`, `TROUBLESHOOTING.md`, and the `docs/archive/agent-work/AgentRouterWork/` handoff first. Keep calculations in `src/domain`, PocketBase access in `src/data`, route orchestration in `src/routes`. Preserve business-date → created → id ordering, integer financial units, separate Kacha/GST pools, and the stable Sales behavior.

**Safety and scope:** Work on the Arch Linux checkout in a feature branch only. Do not push to master. Do not run migrations, seeds, backup/restore, or write tests against the live runtime/database during implementation. Do not change old migrations. Phase 2 must add the shared module settings as a **new** migration under `pb_migrations/`. Never merge the existing customers/suppliers or item collections. Do not change Sales financial math. Keep runtime, credentials and backups out of git. All disabled-module routes need a consistent guard, including command palette, search, mobile navigation and deep links. A switch is a UI/access setting, not a data-deletion operation. When that migration is later deployed to the designated Windows primary, PocketBase applies pending migrations on restart; before that Windows restart the owner must run `windows\backup-kapil.ps1` on the Windows PC and follow the Windows runbook.

**Design language:** Page background `#f1f5f9`, Geist, `rounded-xl border bg-white shadow-sm` cards, slate-900 primary buttons, sparse color reserved for state. The top bar owns the page title: no duplicate H1. No side drawers. Keep compact data tables, clear financial labels, keyboard access and mobile layouts.

**One phase per session.** At the start of every implementation session, read `docs/features/restructure-plan.md`, then perform only the phase named in that session's prompt. Implement phases in order. Each phase must leave working navigation and be independently committable. Use the smallest meaningful tests listed below, `npm run verify` after application changes, and inspect `git status --ignored` before a commit. If tokens run low, stop cleanly after a finished, verified phase; record the next phase and any unresolved risk without starting partial work.

### 1. Labels, order and AI Drafts move only

Edit `src/components/layout/sidebar-nav.tsx`, `src/components/layout/app-shell.tsx` (page metadata and command labels), and relevant visible route labels. Move AI Drafts to a top-level item, place Party Ledger immediately after it, rename Sales and Purchase entries, and reorder the existing entries toward the target tree. Keep every current route and sidebar destination working. **Do not remove Customers, Suppliers, Purchase Items or Casting Materials entries or add their redirects in phase 1.** Keep their temporary entries under the relevant existing group until phases 5 and 6 replace them. Add `/sales-dashboard` only in phase 4. Do not build replacement pages or module switches in this phase.

### 2. Shared module settings and route guards

Existing `src/lib/module-settings.ts`, `src/lib/use-module-settings.ts`, and `src/routes/settings.tsx` support only a browser-local Casting flag. Extend to Purchase and Casting through a new shared PocketBase settings record and a data module. **Add a new migration** under `pb_migrations/`; do not edit prior migrations or run it against live data. Document the Windows restart behavior and the required pre-restart `windows\backup-kapil.ps1` in the phase handoff. Default both modules on when settings are absent or temporarily unavailable, with a visible load/error state so a failed read does not silently hide modules. Add a common route guard in `src/routes/__root.tsx` or route wrappers; apply to direct routes, command routes in `app-shell.tsx`, quick search, sidebar, mobile actions and report links. Keep `/settings` accessible. Define whether the shared setting needs authenticated admin-only writes using existing auth rules; enforce server-side authorization. Dashboard, calendar, company report, items and Party Ledger must omit disabled-module data and stop disabled queries where practical.

### 3. Shared logs shell

Build a reusable table shell for filters, status, date range, CSV, empty/error states, action confirmations and pagination. Adapt `src/routes/transactions.tsx` (Sales), `src/routes/purchase-logs.tsx`, and `src/routes/casting/log.tsx`; retain their separate data sources and domain-specific actions. Sales currently loads `loadTransactionsContext` and has a table plus other panels; add real pagination to the log table. Purchase uses purchase bill/payment/audit query options; Casting uses `src/data/casting.ts`. Do not force different event shapes into one financial calculation. Keep distinct Sales/Purchase/Casting URL filters and audit semantics.

### 4. Dashboards

Keep the layout of `src/routes/index.tsx`; add compact Purchase and Casting one-glance sections governed by settings. Reuse `src/data/purchase-queries.ts`, `src/domain/purchase-dashboard.ts`, and `src/components/purchase-dashboard/`; avoid a second outstanding formula. Create `/sales-dashboard` from existing Sales dashboard/ledger data (`src/data/dashboard.ts`, `src/domain/dashboard.ts`) using due, collected, bills and useful recent activity. Keep `/purchase-dashboard` focused on owed, bought, pay next and its existing spend/grade views. Keep Casting dashboard in `src/routes/casting/index.tsx`. Move “net buffer” below the headline and label it as incomplete until opening stock and stable material IDs exist; do not present a negative proxy as inventory truth. Dashboard drill-down links must respect disabled modules. Put Purchase Payments history in a tab on `/purchase-bills`, then redirect its old history route while preserving relevant filters.

### 5. Universal Party Ledger UI

Rework `src/routes/ledger.tsx` and its list/detail components to present customer and supplier records together with a clear Sales/Purchase type filter. Reuse `src/data/ledger.ts`, `src/data/customers.ts`, `src/routes/customers.tsx`, `src/routes/supplier-ledger.$supplierId.tsx`, `src/data/suppliers.ts`, and supplier settlement/ledger domain modules. Keep separate IDs, tables, balances and exports; never infer one legal party from matching names or net receivable against payable. Move customer create/edit/active controls into the ledger UI, alongside supplier controls. Preserve customer statements and PDF/XLSX/ZIP exports and supplier bill/payment/bardan history. Support old `?customerId=`, `?supplierId=`, `?focus=` links; use an explicit party-kind parameter for any new combined selector. **Only in phase 5**, remove Customers and Suppliers sidebar entries and redirect `/customers` and `/suppliers` to `/ledger`, preserving selected records and query context; retain or redirect `/supplier-ledger/$supplierId` deep links. No side drawer.

### 6. Unified Items UI

Use `src/routes/items.tsx` as the one screen with Finished Goods (`items`), Raw Materials (`purchase_items`), and Casting Materials (`casting_materials`) tabs. Reuse `src/data/items.ts`, purchase item access in `src/data/suppliers.ts`, `src/data/casting.ts`, and current `src/routes/purchase-items.tsx` / `src/routes/casting/materials.tsx` behaviors. Keep collections distinct. Show casting session usage read-only in the Casting tab; item maintenance can use existing collection operations. Add an explicit alias/mapping model before allowing a casting material rename to alter cross-module totals. Preserve historical `material_name` text and old names; never rewrite historical sessions casually. Gate tabs by module settings and preserve tab deep links. **Only in phase 6**, remove Purchase Items and Casting Materials sidebar entries and redirect `/purchase-items` and `/casting/materials` to their `/items` tabs, retaining old deep links.

### 7. Calendar and reports

Extend `src/routes/monthly-sales-calendar.tsx` / `src/data/calendar-month.ts` to show dated Sales, Purchase and Casting activity with per-module legend/filter. Extend `src/routes/monthly-report.tsx` to a company view with module sections and clear receivable/payable labels, while preserving Sales calculations. Create three dedicated report routes under `src/routes/reports/` using existing domain/data summaries:

- **Sales Report:** party-wise, item-wise, monthly trend, and receivable ageing buckets 0–30, 31–60, 60+ days.
- **Purchase Report:** supplier-wise, item-wise kilograms and average rate versus *vilaity*; payable ageing; bardan-pending ageing; RCM liability by month. Vilaity is an internal comparison only and must be excluded from every export.
- **Casting Report:** sessions table, wastage percentage trend, chol recovered, inputs by material, and cost per kilogram trend.

Keep `src/routes/export-reports.tsx` and conditionally show module outputs. Never calculate a combined company position by automatically netting independent receivables and payables. Disabled modules must disappear from links, views and exports without deleting data.

**Minimal verification per finished phase:** route and redirect checks; disabled-module deep-link/command/search checks; Sales bill/payment totals unchanged; one Party Ledger customer and one supplier with separate balances; casting rename alias preserves historical purchase-to-casting match; pagination/CSV row scope; calendar/report module visibility; desktop/mobile smoke for changed screens. Add focused domain or data tests only for new financial or identity logic. Do not use the live business database as a fixture.

## Known risks

1. `src/domain/purchase-dashboard.ts` matches casting `materialName` to purchase item names through lowercasing and hard-coded aliases (`brass`, `chol`, `pata`, `marobol`, `sisu`, `gun`). Renaming either side can silently lose “melted” totals. Build a stable alias/mapping contract before changing names.
2. “Net buffer” compares purchase history since cut-over with casting usage but has no opening stock. It must not be promoted as an inventory balance.
3. Shared switches need a new durable settings contract and consistent direct-route guards. The current Casting flag is localStorage only, so a sidebar-only change would leave deep links and other users inconsistent.
4. The existing Sales/customer and Purchase/supplier collections and financial directions differ. Unified screens must retain separate ledgers and exports; matching names are not a safe merge key.
5. AI Drafts currently consist of `bill_drafts` and `payment_drafts` for Sales. Moving the entry point does not create Purchase or Casting draft support; future draft types need explicit schema and approval workflows.
