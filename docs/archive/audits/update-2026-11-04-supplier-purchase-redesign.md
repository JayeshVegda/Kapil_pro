# Update Plan: Supplier Purchase Module Redesign (Phase 5)

**Date**: 2026-11-04
**Feature / Fix**: Supplier Purchase (scrap) module UI/UX rebuild — Bills hub, Payments hub, New Bill split screen, chitty page, item-name hygiene, navigation
**Branch**: `feat/muse-integration` (this phase = commits `0d1c01b` Part A + `cc539d3` Part B, not yet merged to `main`)

---

## 1. Overview & Objective

The supplier purchase module (collection of scrap from suppliers: purchase bills, bardan bag settlements, payments) had grown into scattered ad-hoc screens that did not match the daily-use sales pages (`/ledger`, `/print-bill`, `/new-payment`). This phase rebuilt the module view layer so both sides of the business feel like one app.

### Key Requirements

1. **One shell, one page-list family**: all purchase screens share a `PurchasesShell` (supplier rail, mirroring the customer rail) and the same page-list/table conventions as the sales pages.
2. **Bills hub replaces scattered pages**: `/purchase-bills` is the single hub — All / Open / Partial / NIL / Bardan Pending / Cancelled tabs (live counts), pool chips (Kacha/GST), date range, supplier filter, multi-select "Pay Selected" with per-bill pinning, CSV export. The old `/bardan-pending` page is retired and redirects to `?tab=bardan`.
3. **New bill as split screen**: `/new-purchase-bill` keeps form left / live chitty (bill document) preview right with a draggable, persisted divider. `Ctrl+Enter` saves and jumps to the chitty page. Edit mode preserves prefill and warnings.
4. **Chitty page**: `/purchase-bills/$billId` renders the A4-style chitty document with payment rows and the bill actions (record payment, add bardan, settle to nil, cancel bill) — the purchase mirror of `/print-bill`.
5. **Payments hub**: `/supplier-payments` mirrors the customer payments hub: totals chips, pool/kind/mode/supplier/status filters, date range, "Showing n of m", CSV export.
6. **Item-name hygiene**: purchase item names are normalized on create/rename (trim + title case + punctuation collapse) and guarded against case-insensitive collisions, with a one-off normalization script for existing data.

---

## 2. What Was Built

| Area | Files | Notes |
| --- | --- | --- |
| Part A — shell, chitty, modals | `src/components/suppliers/purchases-shell.tsx`, `bill-chitty.tsx`, `bill-modals.tsx`, `purchase-bills-table.tsx`, `supplier-payments-table.tsx` + supporting data-domain fixes, migration `1794640005`, smoke seeder | Supplier rail, chitty renderer, and the five shared modals (payment with bill pinning, add bardan, settle-to-nil, cancel bill, payment details). |
| Part B1 — bills hub | `src/routes/purchase-bills/index.tsx` | Tabs with counts computed pre-status-filter, pool chips, date range + Clear, supplier chip, multi-select payments sorted by date/created, CSV, per-row actions. |
| Part B2 — payments hub | `src/routes/supplier-payments.tsx` | Total/Paid/Advance chips, all filters, CSV with 13 columns incl. cancel reason/private note. |
| Part B3 — new bill split screen | `src/routes/new-purchase-bill.tsx` | Split divider persisted via localStorage (key `kapil-new-bill-split-pct`, 30–70%), supplier context strip (Kacha/GST due, advance, bardan pending, vilaity), `Ctrl+Enter` save → `/purchase-bills/$billId`, `?supplier=`/`?editBillId=` preserved. |
| Part B4 — item-name hygiene | `src/domain/purchase-item-name(.test).ts`, collision checks in `src/data/suppliers.ts`, `scripts/normalize-purchase-items.mjs`, `src/routes/purchase-items.tsx` | 8 passing domain tests; dry-run lists 8 renames with no collisions — **`--apply` not run on live data yet**. |
| Part B5 — navigation | `src/components/layout/sidebar-nav.tsx`, `app-shell.tsx`, `query-invalidation.ts`, `src/routes/bardan-pending.tsx` | Purchases group = Bills, Payments, Suppliers; Purchase Items under Setup; `/bardan-pending` now a `beforeLoad` redirect; removed the now-unused sidebar badge count query + cache key. |

**Scope guard**: no purchase/bardan/settlement math, no data-logic changes, and the sales side is untouched — Part B work is views plus write-time input guards only.

---

## 3. Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck | Pass | `npm run typecheck` clean (route tree regenerated; stale `node_modules/.tmp/*.tsbuildinfo` cleared — it was folding old search schemas into new routes) |
| Tests | Pass | 307 passed / 2 skipped; new `src/components/suppliers/bill-chitty.test.tsx` (preview ↔ view totals parity, totals accumulation, status derivation); fixed stale audit-test mock (`getFullList` never stubbed once create/rename guards landed) |
| Build | Pass | `npm run build` (build also runs `tsc -b`, so strict unused-import and route-typing errors surfaced here and were fixed) |
| Headless smoke | Pass | Playwright against `http://127.0.0.1:4174` — `/bardan-pending` redirect lands on `/purchase-bills?tab=bardan`; bills hub, `/new-purchase-bill`, `/supplier-payments` all load; 0 console/page errors |

---

## 4. State

- All Phase 5 work is committed on `feat/muse-integration` in two commits (`0d1c01b`, `cc539d3`).
- **Open item**: run `node scripts/normalize-purchase-items.mjs --apply` once on the live DB (currently verified as dry-run only), then refetch purchase items. Dry-run renames: brass scrap→Brass Scrap, chol→Chol, coal→Coal, gun metal→Gun Metal, honey brass→Honey Brass, marobol→Marobol, pata→Pata, sisu→Sisu.
- **Follow-up**: the purchase hub/strong blue accent styling is slightly hotter than the sales house style (slate-900 primary buttons, grey input focus, quiet slate chips); a pass applying exactly this spec to B1/B2/B3 is queued next.
