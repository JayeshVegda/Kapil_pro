# Kapil Billing: Three-Module Restructure, Build Plan

Give this whole file to the coding agent. Work ONE STEP PER SESSION. Phase 1 (renames and sidebar order) is already done.

## How to start each session (paste this one line, change the step number)

```
Read docs/features/kapil-restructure-build-plan.md completely. Implement ONLY Step N. Feature branch only, no master push, no live-DB changes. Run npm run verify, commit, then reply in max 10 lines: what changed, what to eyeball, what is blocked. Do not start Step N+1. If tokens run low, stop after a finished, verified sub-step and say what is next.
```

## 1. Goal (owner's words, simplified)

Kapil Products has 3 businesses in one app: SALES (polished, the visual reference), CASTING (works, barely used), PURCHASE (new, about 10 days from real use). The owner is the only user.

- The app must feel like one system with a clear section per business.
- **Three separate worlds. Nothing is linked between modules, even when names match.** A "Chol" in Casting and a "Chol" in Purchase are unrelated records.
- One **Items** page with 3 tabs: Sale Items, Purchase Items, Casting Items. Each tab does full CRUD on its OWN table.
- One **Party Ledger** page with 2 tabs: Customers, Suppliers. Separate tables, separate ledgers, never netted or merged.
- A main **Dashboard** with a month picker: casting done, who to pay, who to receive, latest bills, "vs last month" arrows.
- Purchase and Casting can be switched on/off in Settings (shared across devices). When off, they vanish everywhere (sidebar, Ctrl+K, dashboard, calendar, reports, Items tab, Party Ledger tab, direct URLs). Data is never deleted.
- Dense, scannable, fast with a lot of data, one unified theme with reusable components.
- Current data is DEMO. Do not spend effort preserving or cleaning it.

## 2. Hard rules (apply to every step)

- Do not change Sales financial math. Do not touch `bill-books.ts`.
- Never edit old migrations. Add NEW migration files only (new timestamps). The Windows PocketBase applies pending migrations on restart: say so in your final reply and tell the owner to run `windows\backup-kapil.ps1` first. Never run migrations or tests against the live runtime/database.
- Feature branch only. Do not push master.
- Money is integers (paise) in Purchase; keep Sales as it is. Never invent a combined receivable-minus-payable headline.
- Soft-delete philosophy: records that are referenced are deactivated, not deleted (see the delete rule below).
- Keep old URLs working with redirects until their replacement exists; remove the old sidebar entry in the same step that builds the replacement.
- Keep logic in `src/domain`, PocketBase access in `src/data`, orchestration in `src/routes`.
- Minimal tests: only those listed per step. Do not use the live database as a fixture.

## 3. Decisions (final)

| Topic | Decision |
|---|---|
| Item linking | None across modules. Remove name matching in `src/domain/purchase-dashboard.ts` (lines ~145-148) and drop the "Melted in furnace" column and "Net buffer" from the Purchase Dashboard. Furnace data lives on Casting pages and the main Dashboard only. |
| Delete rule (items) | Unused item: delete with a confirm dialog. Used item (appears in any bill line or casting input, by relation id OR copied name): delete is blocked and "Deactivate" is offered. Same pattern for all three item tabs. |
| Parties | Customers and suppliers are deactivated, never deleted. |
| Disabled module URL | Redirect to `/` with a toast "Purchase is turned off in Settings" (or Casting). `/settings` is always reachable. |
| Tab names | Items: **Sale Items · Purchase Items · Casting Items**. Party Ledger: **Customers · Suppliers**. Active tab synced to the URL (`?tab=`). |
| Colour | Sales is the reference. rose = overdue/errors, emerald = paid/advance/positive, amber = pending/warning, slate = neutral, blue = selection only. Amounts owed are neutral slate, not red. Primary button = `bg-slate-900 text-white`. No `bg-blue-600` buttons. |
| Text size | Minimum 11px. Replace `text-[9px]` and `text-[10px]` with `text-[11px]`. Allowed scale: text-base (modal titles), text-sm, text-xs, text-[11px] font-mono (refs). |
| Supplier PDF/XLSX/ZIP statements | Later (not in these steps). |
| Trash stores | Sales Logs and Casting Logs keep their browser-local trash/restore as it is. Purchase Logs does not get one (it has the audit log). |
| Dashboard links | Cards link to the matching module page. |
| Logs at scale | Server-side date window (default last 90 days) plus client pagination (25 per page, selector 25/50/100). No server paging, no stored party balances. |
| Libraries | Add `@tanstack/react-table`. Add `class-variance-authority` only if not installed. Add `@tanstack/react-virtual` only if a ledger proves slow. No Storybook (use a `/dev/components` route). No nuqs, no react-hook-form. Keep recharts and lucide-react. |

## 4. Design language (the visual reference is /print-bill and /new-payment)

- Page bg `#f1f5f9`, font Geist Variable. Wrapper `w-full px-3 pb-10 pt-3 sm:px-4 lg:px-6`, sections `space-y-6`, split screens `xl:grid-cols-2` (or 12-col).
- Every box: `rounded-xl border border-slate-200 bg-white p-4|5 shadow-sm`. Nested areas `rounded-lg border border-slate-100`. Empty states dashed `slate-300` on `slate-50`. Nothing stronger than `shadow-sm` except dialogs.
- Card header: `h2 text-sm font-semibold text-slate-950` plus optional `text-xs text-slate-500` subtitle and a right-side action or chip.
- Tables: `thead bg-slate-50`, th `px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500`, rows `border-t border-slate-100 px-3 py-2`, money `font-mono tabular-nums`, secondary line `truncate text-xs text-slate-500`. Sticky header, sticky first column, `overflow-x-auto` with a sensible `min-w`.
- One shared `inputClass` (h-9/h-10, `border-slate-300`, grey focus ring `focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30`). Retire the blue, indigo and ring/30 variants.
- Buttons: primary dark slate; secondary white with `border-slate-300`; tertiary text with underline on hover. Segmented toggle: `bg-slate-50 p-1`, active white with `ring-1 ring-slate-200`.
- The top bar (AppShell via `resolvePageMeta`) owns the page title. Pages never repeat it as an H1.
- No side drawers. Viewing = a full page. Small actions = centered Radix dialogs (Esc closes, Ctrl+Enter submits).
- Indian number grouping everywhere; dates in the existing display format; Title Case labels (no UPPERCASE labels except table headers).
- Icons: size 16 in nav/toolbars, 14 in buttons.
- Every icon-only button has an `aria-label`.

## 5. Shared kit (Step 0 builds or adopts these; later steps only assemble them)

Existing but unused today: `ui/button`, `ui/table`, `ui/form-field`, `ui/input`, `ui/stat-tile`, `ui/page-header`, `ui/panel`, `ui/empty-state`, `ui/confirm-dialog`. Adopt and fix them rather than writing parallel versions.

| Component | Props sketch | Replaces |
|---|---|---|
| PageShell | title (optional, AppShell owns it), toolbar, badge, actions, children | headers in items, transactions, purchases-shell |
| SectionCard | title, subtitle, actions, children | raw `rounded-xl border bg-white p-5 shadow-sm` sections (wraps ui/panel) |
| DataTable | TanStack Table: data, columns, sorting, pagination (25 default), sticky header and first column, footer totals, column visibility, empty/loading/error states, optional row selection | ad-hoc tables in transactions, casting/log, purchase-bills-table, ledger |
| FilterBar | search, date range, chips, actions slot (CSV etc.) | filter strips in transactions, purchase-logs, ledger |
| KpiCard | label, value, subtext, delta (vs last month), tone, icon, href | MonthStat, Metric, snapshot-tiles |
| MoneyCell | valueRupees or valuePaise, tone, decimals | scattered formatInrInteger / formatPaiseInr spans |
| StatusChip | label, tone | StatusPill and inline chip spans (Kacha/GST, Open/Partial/NIL, Pending) |
| SegmentedToggle / TabBar | options, value, onChange (URL-sync helper) | raw button toggles in items, ledger, transactions |
| ConfirmModal | open, title, description, tone, onConfirm | window.confirm and bespoke overlays |
| FormField | label, error, required | hand-rolled label + span |
| EmptyState, MonthPicker, ModuleGate | per audit | per audit |

## 6. Steps

### Step 0: Foundation (visual clean-up and kit)

1. Tokens: export one `inputClass` (and the matching select/textarea classes) and use it everywhere (blue, indigo, ring/30 variants removed). Replace `text-[9px]` and `text-[10px]` with `text-[11px]`. Map `red-*` to `rose-*`, `yellow-*` to `amber-*`, `green-*` to `emerald-*`, and `indigo-*` in drafts to the neutral/selection style. Do this with search-and-replace only on class names; do not change logic.
2. Build or fix the kit in section 5. Install `@tanstack/react-table`. Add a `/dev/components` route showing each component in each state (loading, empty, error, populated, 500 rows). Hide it from the sidebar; reachable by URL and Ctrl+K only.
3. Quick wins from the audit: remove the duplicate H1s (`items.tsx:157`, `export-reports.tsx:551`, `supplier-ledger.$supplierId.tsx:459`); change primary buttons in `purchase-logs.tsx`, `casting/log.tsx` and `purchases-shell.tsx` to dark slate; add `tabular-nums` to money cells in `purchase-bills-table.tsx` and `casting/log.tsx`; add `aria-label` to icon-only buttons in `transactions.tsx`, `casting/log.tsx`, `items.tsx`, `purchase-logs.tsx`; add `overflow-x-auto` plus `min-w-[700px]` to tables that lack it (`new-purchase-bill`, `casting/log`).
4. Delete `BillDetailDrawer` (`src/components/suppliers/bill-detail-drawer.tsx`) once no route imports it; if something still does, route it to the chitty page or a centered dialog.
5. Replace custom overlay modals in `casting/log.tsx` with the Radix-based ConfirmModal/Dialog (Esc closes, focus trapped).
6. Do not restyle Sales pages beyond the token swaps above. Sales alignment is Step 7.
Tests: StatusChip tone map; MoneyCell formatting (Indian grouping, tabular, paise vs rupees); DataTable pagination slicing.

### Step 1: Module settings, guards, decoupling

1. New migration: collection `app_settings` with a single record `global_settings` (`purchase_enabled` bool default true, `casting_enabled` bool default true). API rules follow the same convention already used for the supplier collections (admin user only for write; Muse role has no access; reads for logged-in users). Seed the record in the migration.
2. Replace the localStorage-only flag in `src/lib/module-settings.ts` / `use-module-settings.ts` with this record (React Query, 5-minute staleTime, localStorage as a fast first-paint cache). Defaults: both on when unavailable, with a visible error state so a failed read never silently hides modules.
3. `ModuleGate` component and `useModules()` hook. Apply to: sidebar sections, mobile bottom nav, Ctrl+K command routes, quick search, dashboard cards, calendar layers, report sections, Items tabs, Party Ledger tabs. Settings page "Modules" card with switches for Purchase and Casting; saving shows a toast; `/settings` is never gated.
4. Route guards: `beforeLoad` in every `/purchase-*`, `/new-purchase-bill`, `/new-supplier-payment`, `/suppliers`, `/supplier-ledger/*` and `/casting/*` route (use a shared helper) that redirects to `/` with the toast when the module is off. Sales routes are never gated.
5. Remove name-matching between casting and purchase in `src/domain/purchase-dashboard.ts`; delete the "Melted in furnace" column and "Net buffer" from the Purchase Dashboard (and the Furnace Melted KPI card if it depends on them) and fix its tests.
Tests: module gate helper (on/off, defaults, failed read keeps modules visible, redirect target); purchase-dashboard still totals correctly without casting.

### Step 2: Main Dashboard (`/`)

Keep the existing layout and styling. Add:
- **Month picker** at the top (default current month; also "FY to date" Apr-Mar). Parameterise `buildDashboardSummary` and the loaders by month. Each KPI shows a small delta "vs last month".
- **Casting** (gated): wire-out kg, wastage % (derive `(in - out) / in * 100`), cost per kg, sessions count for the month.
- **Sales**: billed, received, total still to receive (reuse existing summary).
- **Purchase** (gated): bought kg and amount, paid out, total still to pay (reuse `buildPurchaseDashboard` / `purchase-queries.ts`; do not create a second outstanding formula).
- **Who to pay**: top 4 suppliers by balance with a Pay button (opens the payment flow prefilled).
- **Who to receive**: top 4 customers by outstanding, with the oldest unpaid age.
- **Latest bills**: last 5 sale bills and last 5 purchase bills side by side (Purchase list gated).
- Cards link to their module pages. When a module is off, its cards disappear and the grid reflows. Loading uses skeleton cards, empty uses EmptyState.
- New `/sales-dashboard` is NOT built in this step; keep the sidebar entry pointing at a simple page or hide it until built (state which in the reply).
Tests: month-scoped loaders (boundary dates, empty month), delta calculation (zero previous month does not divide by zero), wastage % calculation.

### Step 3: Items page (3 tabs, separate tables)

1. New migration: add `active` (bool, default true) to `items`. Standardise API rules on `casting_materials` (same convention as above). Do not touch other fields.
2. `/items` becomes: SegmentedToggle **Sale Items · Purchase Items · Casting Items** synced to `?tab=`. Purchase and Casting tabs hidden when those modules are off.
3. Each tab: DataTable with search, Active/Inactive filter, inline rename, add row (Enter adds), Deactivate/Activate, Delete. Columns per tab: Sale (name, unit, default rate, group, bag weight, active); Purchase (name, active, bills count, last rate); Casting (name, code, category, is_active, sessions count).
4. Name rule: Title Case on NEW and EDITED names only (trim, collapse spaces, keep GST/RCM acronyms); case-insensitive unique check inside the tab only. Never rewrite old records.
5. Delete rule: "used" = referenced by relation id or by copied name in `bill_items` (Sale), `purchase_bill_lines` (Purchase), `casting_batch_inputs` (Casting). Unused = delete with ConfirmModal. Used = delete blocked, show "Used in N records" with a Deactivate button.
6. Redirects: `/purchase-items` -> `/items?tab=purchase`, `/casting/materials` -> `/items?tab=casting` (the old usage report becomes a small read-only "Usage" column/section on the Casting tab). Remove the "Purchase Items" and "Materials" sidebar entries and Ctrl+K entries in this step. Fix the "Items Master" vs "Items" title mismatch.
7. No linking across tabs, no alias model, no shared item table.
Tests: Title Case + acronym rule; delete-protection (unused vs used for each of the three tabs); case-insensitive unique within a tab but allowed across tabs.

### Step 4: Party Ledger (Customers | Suppliers)

1. `/ledger` becomes two tabs **Customers · Suppliers** synced to `?tab=` (default customers). Suppliers tab hidden when Purchase is off.
2. Customers tab = the existing customer ledger and statement unchanged (PDF, XLSX, ZIP bundle, HTML print, drill-down), plus customer create/edit/deactivate moved here from `/customers` (credit limit, aliases, GSTIN, opening balance, etc. must survive).
3. Suppliers tab = the existing supplier list with a left rail (name, owed, advance, bardan dot), supplier create/edit/deactivate, and the supplier ledger (Ledger | Bills | Payments) with its JPG export and bill/payment links to the chitty page. Move the content of `src/routes/suppliers.tsx` and `src/routes/supplier-ledger.$supplierId.tsx` into this tab; keep `/supplier-ledger/$supplierId` as a redirect to `/ledger?tab=suppliers&supplierId=...`.
4. Never net, blend or combine customer and supplier balances or formulas. No "company position" figure.
5. Redirects: `/customers` -> `/ledger?tab=customers`, `/suppliers` -> `/ledger?tab=suppliers`; preserve old query params (`customerId`, `supplierId`, `focus`). Remove the Customers category and the Suppliers entry from the sidebar and Ctrl+K in this step.
Tests: tab and deep-link parsing (old params still select the right party); customer and supplier balance functions are untouched (reuse existing tests).

### Step 5: Logs (shared shell, pagination)

1. Build `LogsShell` on top of FilterBar + DataTable: search, date range, chips, CSV button, empty/error/loading, pagination 25/50/100, row-action slot.
2. Server-side date window: load the last 90 days by default with a "Load older" range selector; client pagination on top. No `getFullList()` without a date filter on the log pages. Use PocketBase `fields` projection to omit line items, photos and private notes from list queries.
3. Migrate Purchase Logs first (keep its bill/payment/audit tabs, filters and CSV), then Casting Logs (keep its browser-local trash/restore), then Sales Logs (keep its edit/trash/restore, add pagination and CSV). Distinct data sources and row actions stay; only the shell is shared.
4. Purchase Bills page: add the same pagination and date window.
5. Retire "Sales Logs / Print Bill" naming mismatches in titles.
Tests: pagination slicing and page-size changes; date-window filter builder; CSV exports only the visible filtered rows.

### Step 6: Reports

1. Calendar (`/monthly-sales-calendar`): add layer toggles Sales / Purchase / Casting (off modules hidden). Day cells show sales total, purchase total, casting kg compactly. Click a day opens a centered modal listing that day's bills, payments, purchases and casting sessions with links. Reuse `loadCalendarMonthData`; add purchase and casting loaders.
2. Company Report (`/monthly-report`): date range or FY picker; sections Sales summary, Purchase summary (Kacha/GST split, RCM liability), Casting summary (wire out, wastage %, chol recovered, cost/kg). No combined receivable-minus-payable headline. JPG/CSV export via existing helpers; purchase premium vs vilaity and private notes never appear in exports.
3. Module reports (`/reports/sales`, `/reports/purchase`, `/reports/casting`), tabs or three sidebar entries under Reports:
   - Sales: party-wise, item-wise, monthly trend, ageing 0-30 / 31-60 / 60+.
   - Purchase: supplier-wise, item-wise kg and average rate (premium vs vilaity shown as internal only, excluded from exports), payable ageing, bardan-pending ageing, RCM liability by month.
   - Casting: sessions table, wastage % trend, chol recovered, inputs by material, cost/kg trend.
4. Exports page: keep as is; add purchase and casting data to backup/export only if it is a small change, otherwise list it as a follow-up.
5. Disabled modules disappear from all of the above.
Tests: calendar day aggregation across the three modules (a day with only purchase data still renders); ageing bucket boundaries.

### Step 7: Sales alignment (last)

Align `/transactions`, `/new-bill`, `/new-payment`, `/print-bill` to the shared kit (DataTable, FilterBar, StatusChip, MoneyCell, inputClass). Create the real `/sales-dashboard` (sales-only: KPIs, monthly trend, top 10 customers by outstanding, top items by kg, recent bills and payments, ageing buckets) from existing domain functions with no new money logic. Take Playwright screenshots (`scripts/smoke-ui.mjs`) before and after; any visual regression on Sales must be fixed or reported. Sales behaviour and totals must be identical.
Tests: existing Sales tests must still pass unchanged.

## 7. Final reply format for every step (max 10 lines)

Steps completed, files changed or removed, migrations added (and the reminder to back up before restarting PocketBase), anything blocked, what to eyeball in the UI.

## 8. Known risks to keep in mind

- Windows PocketBase auto-applies pending migrations on restart: always back up first.
- Disabled-module guards must cover direct URLs, Ctrl+K, quick search and mobile nav, not only the sidebar.
- Sales `customers` use rupee floats; Purchase `suppliers` use integer paise. Never share formulas between them.
- Old redirects must keep working so old bookmarks and Muse draft links do not break.
