# Purchase Module UI/UX Overhaul — Plan (2026-11-08)

> Status: **COMPLETED — 2026-11-08.** All 7 workstreams implemented; `npm run verify`
> (router:generate + `tsc -b` + tests + build) passes. Live browser spot-checks were done for
> dashboard / new-purchase-bill / purchase-bills / suppliers at 1366×900; the remaining
> responsive screenshot matrix (1920 / 390) and modal live-checks were **skipped per owner
> instruction**. Everything is uncommitted on `feat/muse-integration` (HEAD `06de703`).
> Branch: `feat/muse-integration` (prior audit repairs uncommitted on top of `06de703`).
> Skills referenced: `design-taste-frontend` (hierarchy before decoration), `frontend-ui-engineering`
> (production accessibility + state), `shadcn` (primitives: Dialog / Collapsible / DropdownMenu),
> `humanizer` (labels + microcopy), `vercel-react-best-practices` (perf/conventions),
> `webapp-testing` + `playwright-cli` (verification).

---

## 0. Theme guardrail (from project AGENTS.md)

All work stays inside the existing slate/blue business-tool identity: white `Panel` surfaces,
slate dividers, soft blue accents, restrained green/red/amber. No new dependencies, no
finance-terminal styling, no dramatic redesigns. Every change must feel like the same app.

## 0.1 Confirmed code facts (verified today)

| Fact | Location |
| :--- | :--- |
| Sidebar desktop `aside` + `nav` with `overflow-y-auto` | `src/components/layout/sidebar-nav.tsx:236-243` (mobile drawer mirror at 246-262) |
| Page grid is `grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]` | `src/routes/new-purchase-bill.tsx:1110` |
| "Adjustments" collapsible `Panel` card (pattern to reuse) | `src/routes/new-purchase-bill.tsx:1572-1608` |
| "Payment made on bill day" always-open `Panel` **above** the bottom bar, after adjustments | `src/routes/new-purchase-bill.tsx:1712-1730` |
| Text summary block (Bill amount / Paid on bill day / due after credits / items line) | `src/routes/new-purchase-bill.tsx:1779-1800` |
| Chitty already rendered with min-width 500px wrap | `src/routes/new-purchase-bill.tsx:1797` (`BillChitty mode="preview"`) |
| Money shorthand parser exists and is shared | `src/lib/inr-format.ts:92-129` (`parseAmountShorthand`, export at L135/L142; `MAX_PAYMENT_AMOUNT` L79) |
| Bill-day payment state/builder | `paymentAmount/paymentMode/paymentReference` state → payload in `src/data/suppliers.ts:670-694`; input type `PurchaseBillCreateInput:560-577` |
| Logs row actions (record payment, cancel bill) as bare icon buttons | `src/routes/purchase-logs.tsx:685-757` (icons at 720, 730) |
| `ConfirmDialog` primitive exists, barely used | `src/components/ui/confirm-dialog.tsx` (only `new-purchase-bill.tsx:1882`, `items.tsx`) |
| Ledger master-detail pattern with `?customerId=&focus=` | `src/routes/ledger.tsx:23-24, 57-72` + `src/components/ledger/party-list-panel.tsx` |

---

## 1. Sidebar polish (scrollbar + standardization)

**Problem.** The `nav` is `overflow-y-auto` inside `h-dvh` with `overflow-hidden` on the `aside`
(`sidebar-nav.tsx:236-243`, desktop; 246-262 mobile). Overflowing content produces a browser
scrollbar over the dark navy rail — the artifact-reported. Item treatments are non-standard
vs the rest of the app.

**Approach.**
1. Restructure rail into three fixed regions: brand header (fixed), scroll region (`flex-1 min-h-0`),
   footer/user block (fixed). The middle region scrolls only when it *must*, with a
   `scrollbar-thin`-style styled scrollbar (2px thumb matching rail) instead of the native one.
2. Redesign nav item rows to standard pattern: 8px rhythm, 32px rows, icon 16px, active state =
   soft blue tint (existing `bg-blue-*` token), hover = `white/5`, no floating pill borders.
   Group headers (LABELS, PURCHASE, SALES …) become 10px uppercase spaced labels per
   `design-taste-frontend` hierarchy rules.
3. Collapse long sections behind same-height rows if total rail height exceeds viewport — target:
   zero scrolling at ≥900px viewport height with CachyOS default zoom.
4. Apply identical treatment to the mobile drawer (same component const), keep `w-[292px]`.

**Files.** `src/components/layout/sidebar-nav.tsx` only (plus a tiny `rail-scroll` utility class
if needed in `src/index.css` / tailwind config).

**Acceptance.** No visible scrollbar at default viewport; active/hover/focus states consistent;
keyboard nav unchanged; mobile drawer unchanged behavior (open/close).

---

## 2. `/purchase-dashboard` redesign

**Problem.** 987-line page, 4 loosely related sections, no clear scan order; data explains little.

**Approach (design-taste-frontend: lead with summary → trend → risk → drill-down).**
Top-to-bottom page composition, all using existing `Panel` / `StatTile` / `SectionHeader` /
`EmptyState` primitives:
1. **Header row** — page title + today/period scope control + primary action ("New purchase bill").
2. **Today strip** — 4 `StatTile`s: bills today, kg bought today, amount today, paid-on-day amount.
   Clicking a tile filters section 3 (drill-down path, `kibana-dashboards` style).
3. **Trend panel** — daily purchases (kg + ₹) for the last 14 days as a compact bar/spark block
   using the app's existing chart approach (reuse what `company-report` uses; no new chart lib
   without `architecture-review`).
4. **Supplier attention panel** — top creditors by outstanding with last-bill age; row click →
   ledger-style supplier detail (see §6), matching the `/ledger?customerId=&focus=overdue`
   entry pattern already implemented for customers.
5. **Recent bills panel** — last N bills (supplier, date, kg, net amount, paid status chip) with
   "View all → Purchase bills".

**Decomposition.** Split the 987-line file into `purchase-dashboard/` folder: `index.tsx` +
`sections/*.tsx` (`improve-codebase-architecture` rule about route orchestration). Data stays in
`src/data`, no duplicated totals math — reuse existing domain helpers.

**Acceptance.** Each section clickable into its detail page; tile numbers match `purchase-bills`
totals for the same scope; mobile stacks in one column with the "New purchase bill" button
reaching within thumb zone; `webapp-testing` a11y smoke passes.

---

## 3. `/purchase-bills` — simpler header/toolbar

**Problem.** Header/toolbar (`src/routes/purchase-bills/index.tsx`, toolbar region) shows too much
information: multiple filter groups, counts, and metadata in one strip — crowded at 1366px.

**Approach.**
1. Single compact toolbar: [search] [supplier filter (SearchableCombobox)] [status select]
   [date-range] [↺ clear]. Everything else (counts/detail) moves into a secondary line only
   when non-default, or into the list itself.
2. Move "N results · total ₹X" into a quiet right-aligned text next to the toolbar instead of
   dedicated info chips.
3. Columns in the list: Date · Supplier · Items(kg) · Net ₹ · Status — status as the existing
   colored chip; preview pane on the right unchanged (it's the detail view).
4. Empty/failure states use `EmptyState` with the standard "No bills match filters" + clear-filters
   action.

**Acceptance.** Toolbar fits one row at 1280px; all current filters remain reachable (none deleted,
only reorganized); counts still verifiable; screenshot at 1366/1920/mobile shows no crowd.

---

## 4. `/new-purchase-bill` — 50/50 split, live chitty, payment card

The biggest change. All inside the page's left→right grid and local state; data-layer changes
minimal and additive.

### 4.1 Layout — true 50/50
- `new-purchase-bill.tsx:1110`: change `xl:grid-columns` to `xl:grid-cols-2` (with `minmax(0,1fr)`
  guards) so form and preview share equal width. Remove the `min-w-[500px]` wrapper on the chitty
  (L1797) once the panel has room; add a narrower-chitty density/compact fallback on mobile
  (`BillChitty` already has `density` prop).
- Sticky bottom bar (L1733) stays; it must span the left pane only as today.

### 4.2 Remove text summary — live preview with inline totals
- Delete the summary block at **1779-1800** (supplier name, Bill amount, Paid on bill day,
  due after credits, items line).
- Replace with just the always-mounted `BillChitty mode="preview"`; the chitty itself already
  shows the live arithmetic. Above it, drop in a one-line context strip (supplier + pool +
  bill no. being edited) — nothing more (`humanizer`-policed copy).

### 4.3 "Payment made on bill day" becomes a collapsible card with note + shorthand input
- Reuse the **Adjustments card pattern** (`Panel` + disclosure button + chevron, L1572-1586) for
  the payment section (`1723-1730` moved alongside/after Adjustments, collapsed by default,
  showing a count/amount badge when filled).
- Add a **Note** field (single free-text) to the card →
  `PurchaseBillCreateInput.payment` (`src/data/suppliers.ts:560-577`) gains an optional `note`
  field; payload builder (`:670-694`) passes it through; persistence done additively (PocketBase
  field optional). Rendered later in "PaymentDetails"-style views.
- Replace the numeric amount input (L1718) with the shared
  `src/components/ui/payment-amount-input.tsx` (backed by `parseAmountShorthand`,
  `src/lib/inr-format.ts:92-129`, caps at `MAX_PAYMENT_AMOUNT`). Accepts `350`, `3.5l`, `50k`
  exactly like `/new-bill` quick payment and `/new-payment`. Placeholder copied from those
  pages for consistency.

### 4.4 Save confirmation
- Before the save mutation (`new-purchase-bill.tsx:960-1036`) fires, open a preview-confirmation
  modal: mini chitty + net total + payment line (amount/mode/reference/note) + first-item
  summary, then **Save bill** / **Go back**. Reuse `ConfirmDialog`/`Dialog` from
  `src/components/ui/`. Existing `ConfirmDialog` usage at `:1882` (navigation-away guard) stays.

**Acceptance.** 50/50 split at `xl`; chitty live-updates on every edit; summary text block gone;
payments card collapsed by default with note field; `50k` typed into amount shows ₹50,000 and
preview reflects it; save shows preview modal and only writes after confirm; `npm run verify`
passes.

---

## 5. `/suppliers` → replaced by ledger-pattern page

**Problem.** Page is a standalone searchable list + account panel that duplicates patterns.
**User decision:** remove the page *shape*; rebuild as the customer-ledger UX
(`src/routes/ledger.tsx:23-72` + `party-list-panel.tsx`).

**Approach.**
1. Rebuild the route content as **master-detail ledger**: left = supplier list panel
   (search + outstanding chips as first-class, mirroring customer list behaviors), right =
   selected supplier's account (bills, payments, bardan, outstanding with drill-down rows).
2. URL-driven: `?supplierId=&focus=` (search params validated like ledger's
   `customerId`/`focus=overdue`); links from dashboard, logs, and bills should land
   pre-filtered.
3. Keep route path `/suppliers` (deep links, sidebar, command palette all keep working) but the
   UX is ledger-pattern. Route file `src/routes/suppliers.tsx` is replaced.
4. Reuse ledger components where the model allows (may need prop-generically-namespaced
   variants; keep customer ledger untouched — no shared behavior regressions).

**Acceptance.** Old URL deep links work (`/suppliers`, `/suppliers?supplierId=X`); the page
mirrors ledger interactions (pick party from list, focus param highlights outstanding); TDD unit
test for outstanding sums reuse domain functions (no math duplication).

---

## 6. `/purchase-logs` — popup models + change confirmations

**Problem.** Row actions (record payment at `:720`, cancel bill at `:730`, add bardan, settle
nil) fire via bare icon buttons with no preview/confirm.

**Approach.**
1. Every destructive/action row button opens its proper **domain modal** from
   `src/components/suppliers/bill-modals.tsx` (AddBardanModal / RecordPayment /
   SettleToNil / CancelBill / PaymentDetails) with a **change preview** inside the modal:
   before → after totals, affected bill(s), reversibility (withdraw/cancel for the counter).
2. `Cancel bill` and `Settle to nil`, plus refund/delete of payment rows, additionally pass
   through `ConfirmDialog` with the exact delta ("This removes ₹X of a ₹Y bill for Kaka Pital
   Wala") — humanizer copy rules: no jargon, states the consequence.
3. History rows for reversed actions get a status chip + toast so the log's audit trail keeps
   telling the truth after the modal does its job.

**Acceptance.** All non-read actions in logs go through modal + (for destructive ones) confirm;
no action mutates without user seeing before/after; existing CSV export and summary cards
(not-filtered-data quirk preserved) untouched.

---

## 7. App-wide confirmation/preview-confirmation adoption

- Audit mutating flows across purchase pages with a checklist (table in this doc's appendix):
  save bill, save payment, cancel bill, cancel payment/refund, add bardan, settle nil,
  duplicate bill, navigation-away-with-dirty-form.
- Standard: (a) non-destructive quick actions → inline confirm state or toast; (b) destructive
  or financial-material → modal with before/after preview; (c) dirty-form navigation →
  `ConfirmDialog` (pattern already at `new-purchase-bill.tsx:1882`).
- Roll this out first on purchase pages (per scope), then same pattern informed to sibling
  sales pages as a follow-up (not this plan's deliverable).

---

## 8. Order of work (each step independently shippable) — COMPLETED

| # | Workstream | Status | What actually shipped |
| :-- | :--- | :--- | :-- |
| 1 | Sidebar fix + standardization | ✅ done | 3-region rail (brand / scroll / footer), `.rail-scroll` utility in `src/index.css`, 16px icons, `bg-blue-500/15` active tint, focus rings, same treatment on mobile drawer. |
| 2 | New-purchase-bill rework | ✅ done | True `xl:grid-cols-2` 50/50, text summary block removed, `BillChitty mode="preview"` always mounted, "Paid on bill day" collapsible card (default collapsed) with `PaymentAmountInput` (`50k` → ₹50,000) + Mode + Note (persisted to PocketBase `private_note`, fallback `Paid with purchase bill ${inNo}`), save-preview Dialog before mutation, Ctrl+Enter → confirm dialog. |
| 3 | Purchase-logs modals + confirmations | ✅ done | `CancelBillModal` loads the bill and shows `computeBillNet(..., bardan=[], ...)` net; `RecordPaymentModal` shows after-state due-drop; its amount input uses `PaymentAmountInput`; payment-cancel consequence line (freed `appliedPaise` + advance removal); settle-to-nil checkbox; bardan money-effect preview; 2-step payment-details cancel. |
| 4 | Purchase-bills header simplification | ✅ done | Row-2 border strip removed; "Bill List" row simplified; due moved to footer summary "Showing N of M bills · Open due ₹X" computed from `allBills`. |
| 5 | Suppliers → ledger-pattern master-detail | ✅ done | Route rewritten as master-detail: left `SupplierListPanel` (KPI cards, search, sort cycle, bardan/30d+/inactive badges, count footer, single `+ New supplier` button), right `SupplierLedgerDetail` (exported from `supplier-ledger.$supplierId.tsx`) with Ledger/Bills/Payments tabs + deactivate/reactivate via `ConfirmDialog`. URL `?supplierId=&focus=&tab=`; legacy `?supplier=` alias accepted. Duplicate "New Supplier" buttons removed from `suppliers.tsx`. |
| 6 | Purchase-dashboard redesign | ✅ done | 987-line route decomposed into `src/components/purchase-dashboard/*` (`today-strip`, `snapshot-tiles`, `spend-trend`, `material-matrix`, `pay-next`, `recent-feeds`, `format.ts`, `types.ts`). Order: Today strip → Snapshot tiles (fully clickable overlay links) → SpendTrend + PayNext 2-col grid → MaterialMatrix (grades/cadence audit) → RecentFeeds. Pure CSS bars, `shortInr` L/cr shorthand, drill links to real search schemas (`/purchase-logs?type=`, `/purchase-bills?tab=`, `/suppliers?focus=overdue`). No chart lib added. |
| 7 | Confirmation sweep | ✅ done | Save-bill preview confirm, discard confirm, settle-to-nil, bardan money-effect, payment-details 2-step cancel, supplier deactivate — all confirmed present in code sweep. |

## 9. Verification plan — outcome

- `npm run verify` re-run after every workstream **and** after the final duplicate-button
  removal (final run: router:generate + `tsc -b` + tests + build, dist 4.0s) — **all green**.
  It caught 2 regressions that bare `tsc --noEmit` missed (lost `const` on `totalDuePaise`
  in `bill-modals.tsx`; suppliers search-reducer typing) — both fixed.
- Live browser checks done at 1366×900 (Caddy-served `dist/`, PocketBase `:8090`):
  - `/purchase-dashboard` renders live data (Today "3 bardan pending", tiles ₹6.18L owe /
    ₹8.48L paid, trend bars, Pay Next 4 cards, grade matrix); console clean except 1 minor
    a11y note (form field without id/name). Screenshot: `AgentRouterWork/verify-dashboard-1366.jpeg`.
  - `/new-purchase-bill` payment card expands; `50k` parses to ₹50,000.00 and the chitty
    preview reflects it. Screenshot: `AgentRouterWork/verify-new-purchase-bill-1366.jpg`.
  - `/purchase-bills` footer summary: "Showing 8 of 8 bills" · "Open due ₹7,21,906.00".
  - `/suppliers` master-detail: KPIs render, suppliers sorted by due, single `+ New supplier`
    footer button; deep link `?supplierId=vz0p7eo1negu4fk` selects Kaka Pital Wala with
    Ledger 5 / Bills 1 / Payments 3 tabs and bill `IN-2627-0004` visible.
  - Drill links validated (dashboard recent-bill links resolve via `/purchase-bills/$billId`,
    which looks up by `inNo`).
- **Skipped per owner instruction:** 1920 / 390 screenshot matrix and live modal walk-throughs
  (CancelBill / RecordPayment / AddBardan previews, sidebar scrollbar visual). Logic verified
  in code + typecheck + unit tests instead.

## 10. Assumptions made (until corrected)

1. `/suppliers` keeps its URL (only the page's UX is replaced) unless you say otherwise.
2. Payment note for bill-day payment is additive/optional (old bills show blank note).
3. No new chart library for the dashboard; reuse existing chart approach.
4. Purchase module first for confirmation rollout; sales pages are follow-up.
5. Sidebar zero-scroll target is at default zoom, ≥900px viewport height.
6. "Popup model" = its domain modal with preview + confirmation, as implemented via
   `bill-modals.tsx` + `ConfirmDialog`.
