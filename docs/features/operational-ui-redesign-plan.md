# Operational UI redesign plan

Status: **planning only**. Prepared on Arch Linux. No application code, data, or migration was changed for this plan.

## Decisions

| Topic | Decision |
|---|---|
| Purchase payment filters | Supplier, kind, pool, payee/name, reference/search, and date range. Named filter presets are saved in PocketBase and available across the owner's devices. |
| Purchase bill Edit | Open the **full existing editor** in a centered modal on the current page. Preserve lines, adjustments, payment, photos, validation, and unsaved-change protection. |
| Purchase bill View | Open the dedicated full-page chitty at `/purchase-bills/$billId`; a bill is never inspected in a side drawer. |
| Purchase bill Delete | Label the action **Void**. Use the existing soft cancellation, reason, and audit trail; retain inward number and history. |
| Casting log View | Open the selected casting ticket in a centered modal. Edit remains a centered modal; Delete keeps the existing temporary-trash behavior. |
| Party Ledger | Tab labels become **Sales** and **Purchase**. Customer and supplier records, balances, forms, and calculations remain separate. One shared manager shell exposes create/edit/deactivate in each tab. |
| Module reports | One `/module-report?module=sales|purchase|casting` page with Sales, Purchase, Casting switches. Keep old report URLs as redirects. Disabled modules remain hidden and guarded. |
| Company Report | Keep the user-facing title **Company Report**, move the canonical URL to `/company-report`, and redirect the old `/monthly-report` bookmark. |

## What exists now

- `/new-purchase-bill` has a live `BillChitty`; its chitty table still uses `overflow-x-auto` and nonwrapping cells. The separate “Bill preview” header and Quick Suppliers list were already removed in the interrupted work, but **those edits have not been verified**.
- The interrupted work also changed `loadLatestCastingDefaults` and `/casting/new-session` to prefill coal kg and worker salary as well as coal rate. **Verify this before building on it.**
- `/purchase-bills` has a Bills/Payments switch, a separate date row, bill list plus inline preview, and a payments table with only date/supplier/kind/pool/amount. `/purchase-logs` still navigates to the edit route and shows Pay actions.
- `/casting/log` already has date filters, temporary trash, and an edit modal; its toolbar is tall, and View is absent. `/casting/bill` has a searchable session rail and a print sheet.
- `/ledger` embeds the Sales ledger and customer manager, but supplier creation is inside `SuppliersPage` and supplier edit/status controls are buried in `SupplierLedgerDetail`. The tabs and manager controls are uneven.
- The calendar's five headline cards are Sales-only. Sales/Purchase/Casting switches sit above the calendar, away from Today. The day dialog combines dense sections in one scroll area.
- `/reports/sales`, `/reports/purchase`, and `/reports/casting` are separate table-heavy pages. Sidebar/AppShell already say “Company Report” for `/monthly-report`; the URL and report layout are the remaining mismatch.
- `CastingItemsView` is a standalone compressed form/table, unlike the Sale/Purchase item tabs.

## Design method and boundaries

Use the ideas in [Decision-First Dashboard](https://github.com/fourleaf13-hue/decision-first-dashboard) to choose information that answers **what matters → why → what action**. Use [Dashboard Design](https://github.com/abdiraimov-otabek/dashboard-design-skill) for restrained KPI hierarchy, honest comparisons, filters, states, and screenshot QA. The production UI remains the existing React app and Kapil design kit.

Every screen should have one first-glance job:

| Screen | First-glance job |
|---|---|
| Purchase Bills | Find a bill, see amount/due/state, then View, Edit, or Void. |
| Purchase Payments | Find a payment or a saved view and inspect its allocation. |
| Party Ledger | Pick a Sales customer or Purchase supplier, inspect the separate balance, and manage the party. |
| Casting Log | Find a session, view its ticket, correct it, or move it to temporary trash. |
| Casting Bill | Find a cost sheet, compare the key inputs/output, then print. |
| Calendar | See which days have Sales, Purchase, or Casting activity and open one day's records. |
| Company/Module Reports | Answer period and module questions with source-backed summary, trend, exceptions, and drill-down. |

Follow `docs/ui/CONVENTIONS.md`: slate page background, Geist, white rounded cards, dark slate primary actions, state-only color, `font-mono tabular-nums` amounts, no duplicate page H1, no side drawers, `>=11px` text. Reuse `Panel`/`SectionCard`, `DataTable`, `FilterBar`, `SegmentedToggle`, `StatusChip`, `MoneyCell`, `ConfirmDialog`, and `inputClass` where they fit. Keep dense information reachable through a clear second level rather than adding equal-weight KPI walls.

## Build phases

Complete and verify one phase before starting the next. Update `docs/features/restructure-progress.md` after each phase with done, tested, remaining, and any changed route.

### Phase 0 — Reconcile the interrupted edits

- Review the current diff in `src/routes/new-purchase-bill.tsx`, `src/data/casting.ts`, and `src/routes/casting/new-session.tsx`. Preserve other owner changes; do not reset the dirty worktree.
- Typecheck, lint, and inspect the rendered New Purchase Bill and Casting New Session at desktop/tablet/phone widths before further edits.
- Confirm the latest casting session is selected by business date, created timestamp, then id; prefill coal kg, coal rate, and worker salary only for a new session. Editing an old session must retain its own values.

### Phase 1 — Purchase entry and chitty

Files: `src/routes/new-purchase-bill.tsx`, `src/components/suppliers/bill-chitty.tsx`, any scoped chitty CSS, and their existing tests.

- Remove the extra preview header card completely. Lead directly with a compact **Bill Chitty Preview** card; show pool inside the chitty or its compact metadata, once.
- Reflow the chitty's material lines responsively. At narrow widths use a stacked line layout or a genuinely fitting compact table; do **not** conceal columns with horizontal scrolling or shrink money text below 11px. Preserve print/JPG dimensions and all amounts.
- Replace the empty-supplier Quick Suppliers block with a useful **Recent Purchases** card (recent inward number, supplier, kg, amount, date) and a clear empty state. When a supplier is chosen, show the existing projected dues, advance, bardan, and last-rate brief as one compact card; avoid duplicate figures.
- Acceptance: no horizontal scroll in the chitty at 360/768/1280 px; live preview and printed chitty agree; keyboard entry and bill-day payment still work.

### Phase 2 — Purchase Bills and Purchase Logs

Files: `src/routes/purchase-bills/index.tsx`, `src/routes/purchase-logs.tsx`, `src/routes/new-purchase-bill.tsx`, `src/components/suppliers/bill-modals.tsx`, `src/components/suppliers/bill-chitty.tsx`, `src/data/suppliers.ts`, `src/data/purchase-queries.ts`, `src/app/query-invalidation.ts`.

- Combine Bills/Payments, date range, search, supplier, pool, and the primary action into **one compact card toolbar**. Keep secondary status chips inside the card; avoid a second floating row.
- Bills table actions become exactly **View · Edit · Void**. View goes to the dedicated chitty page. Void opens the existing reason-required soft-cancel dialog. Remove Pay, Bardan, Settle NIL, and Print/JPG from table row actions; keep needed accounting actions in the bill detail or supplier ledger.
- Extract a reusable `PurchaseBillEditor` from the New Purchase Bill route. Open it in a centered, responsive modal from Purchase Bills and Purchase Logs; on save invalidate the read model and remain on the source page and selected row. Support Esc, Ctrl+Enter, and an unsaved-change confirmation. The standalone creation route remains usable.
- Payments view gets supplier, kind, Kacha/GST pool, payee/name/reference text, and From/To filters. Show active filter chips, Clear, Save view, Rename, Apply, and Delete saved view. Keep payment inspection and cancellation separate from bill Void.
- Add an append-only PocketBase migration for owner-only named saved views (scope, name, validated filter JSON, timestamps), plus `src/data/saved-views.ts` and a shared hook. Saved presets sync across devices, contain **filter configuration only**, and never copy payment or private-note data. Filter values stay in the URL for shareable current views; preset selection applies them.
- Acceptance: editing from both pages returns to the same list/filter/page; voided bills remain in history without money effect; payments filters compose correctly and a named preset survives another browser session; Purchase arithmetic is unchanged.

### Phase 3 — Party Ledger and shared manager

Files: `src/routes/ledger.tsx`, `src/routes/customers.tsx`, `src/routes/suppliers.tsx`, `src/routes/supplier-ledger.$supplierId.tsx`, `src/components/ledger/*`, `src/components/suppliers/supplier-list-panel.tsx`, `src/components/suppliers/supplier-form-modal.tsx`, `src/data/customers.ts`, `src/data/suppliers.ts`.

- Rename visible tabs **Sales** and **Purchase**. Keep `?tab=customers|suppliers` and legacy redirects working unless a deliberate redirect migration changes them. Place the switch and **Manage parties** in the same card toolbar.
- Create one `PartyManagerShell` for search, active filter, create, edit, deactivate/reactivate, and confirmation. Feed it separate Customer and Supplier adapters/forms; do not merge tables or financial logic. Make supplier management as discoverable and functional as customer management.
- Rebuild Purchase ledger as a card-based workspace: supplier rail with owed/advance/bardan signal, a selected supplier header, Kacha and GST balance cards, then Ledger/Bills/Payments panels. Keep running balance audit table, bill links, JPG export, and history accessible. Default to a useful selected supplier and preserve `supplierId`, `supplierSection`, `highlightBill`, and `focus` deep links.
- Give the Sales ledger the same shell/spacing and management control without changing its existing statement, PDF/XLSX/ZIP, or balance computation.
- Leave room for a future Casting party adapter, but add no cross-module party link or balance netting now.
- Acceptance: both managers can create/edit/deactivate/reactivate; selected party survives tab operations and deep links; Sales and Purchase balances remain isolated and unchanged.

### Phase 4 — Casting entry, log, and bill

Files: `src/data/casting.ts`, `src/routes/casting/new-session.tsx`, `src/routes/casting/log.tsx`, `src/routes/casting/bill.tsx`, `src/domain/casting-calculations.ts`.

- Verify and finish latest-session defaults (coal consumption, coal rate, worker wages; material rates only where already supported). Keep manual overrides after load and do not overwrite an edit form.
- Put Active/Temporary Trash, search, From/To, and quick ranges into one short card toolbar on Casting Log. Table actions: **View · Edit · Delete**. Reuse one extracted `CastingTicket` in the centered View modal and existing bill page; reuse the current edit modal and temporary trash behavior.
- Casting Bill left card gets search, date range, material filter, and a compact selected session list with useful kg/cost markers. Right side becomes a set of calm cards: session header, output/yield, inputs by material, overhead/cost, and a print action. Use the same underlying ticket data; do not recalculate costs in the route.
- Acceptance: new session defaults from the actual latest run; view/edit/delete work without losing log filters; printed ticket matches on-screen values; no nested horizontal scrolling.

### Phase 5 — Calendar

Files: `src/routes/monthly-sales-calendar.tsx`, `src/components/calendar/*`, `src/data/calendar-month.ts`, purchase/casting loaders as needed.

- Replace Sales-only headline cards with four decision cards for the selected month: **Sales billed**, **Sales collected**, **Purchase bought/paid** (clear two-line pair), and **Casting wire out / sessions**. Hide disabled module content and reflow. Keep Sales-specific gas rate in a lower detail card.
- Move Sales/Purchase/Casting visibility switches into the calendar toolbar beside Today and month navigation. Each day gets a small, consistent three-module stack: Sales amount, Purchase amount, Casting kg, shown only when active and present. Today and selected-day states remain distinct.
- Rebuild the day popup as a centered dialog with a fixed header and **one** vertical scroll region. Use compact Sales/Purchase/Casting sections or tabs, each with direct links to bills, payments, and sessions. On phone, prevent horizontal overflow and keep actions reachable without nested vertical scroll.
- Acceptance: a day containing only Purchase or only Casting still reads as active; all four cards match the selected month; 360/768/1280 px screenshots show no clipped date or dialog control.

### Phase 6 — Reports and Casting Items

Files: `src/routes/monthly-report.tsx`, new `src/routes/company-report.tsx`, new `src/routes/module-report.tsx`, `src/routes/reports/{sales,purchase,casting}.tsx`, `src/components/reports/*`, `src/components/layout/{sidebar-nav,app-shell}.tsx`, `src/lib/module-settings.ts`, `src/routes/items.tsx`, `src/components/items/casting-items-view.tsx`.

- Make `/company-report` the canonical route, preserve `/monthly-report` as a redirect, and keep the AppShell title **Company Report**. Redesign around period, three separate module sections, trend, exception, and drill-down. Label all-time/current balance versus FY activity explicitly. Never show a combined receivable-minus-payable headline.
- Make `/module-report?module=` the canonical module report. One shared page shell with Sales/Purchase/Casting switches, shared date controls, card hierarchy, and module-specific evidence tables. The existing three reports become redirects. Preserve all existing details: Sales party/item/trend/age; Purchase supplier/item kg/rate, internal vilaity comparison, payable and bardan age, RCM; Casting sessions, wastage, chol **in** (until a true recovery field exists), material inputs, cost/kg.
- Update sidebar, Ctrl+K, route guards, and exports to respect disabled modules. Internal Purchase premium and private notes must never enter CSV/JPG/PDF exports.
- Bring Casting Items into the Sale/Purchase Items shell: same search/filter/table/actions rhythm, active state, usage count, Title Case naming, edit/deactivate/delete confirmation. Keep `casting_materials` separate and enforce history reference protection.
- Acceptance: old URLs redirect, toggles hide the correct switch and block deep links, report figures reconcile to source screens, Casting Items looks and behaves like the other two tabs.

## Verification for every phase

1. Use fixtures or isolated test databases only; never run tests, seeds, or migrations against `runtime/data/data.db`.
2. Run `npm run verify` and `cd windows && npx vitest run windows-package.test.ts` after code changes, plus `git diff --check`.
3. Screenshot and inspect desktop, tablet, and 360 px phone for each changed page; test keyboard focus, Esc, Ctrl+Enter, long names, empty/error/loading states, and dialogs at short viewport height.
4. Regression checks: Sales totals/statuses unchanged; Purchase paise/milli/grams and Kacha/GST FIFO untouched; Casting cost calculations unchanged; old deep links and print/JPG outputs preserved.
5. Before any Windows production restart, run `windows\health-check.ps1` and `windows\backup-kapil.ps1`. PocketBase applies pending migrations on restart. Do not deploy from Arch against the live runtime.

## Implementation cautions

- The worktree is already heavily modified. Review diffs first; do not discard owner edits or make a blanket commit.
- Avoid a second purchase editor implementation. Extract the current full form and share it between route and modal; otherwise edit validation and bill-day payment behavior will diverge.
- Keep bill View full-page while Edit is modal. This respects the existing chitty inspection rule and the owner's new same-page editing request.
- A saved preset is a small owner-owned preference record, not a payment snapshot. Validate allowed filter keys before saving or applying.
- Sales customer balances are rupee floats; Purchase supplier balances are integer paise with two separate pools. Shared party UI must not share financial formulas.
- Casting `chol_in` records input. Do not relabel it “recovered” without a separate measured recovery field and a confirmed definition.
- Company and Module reports must distinguish current balances from period flows. Do not imply historical payable from current settlement summaries.

