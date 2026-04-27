# Customers Page Detailed Notes

This document is a detailed technical guide for the Customers page so another AI/engineer can understand and extend it safely.

## File Map

- Route UI: `src/routes/customers.tsx`
- Data module: `src/data/customers.ts`
- Domain aggregation and rules: `src/domain/customers.ts`
- Domain tests: `src/domain/customers.test.ts`

## Product Rules Implemented

- Keep historical `customer_name` snapshots unchanged in old bills/payments (audit-safe rename behavior).
- Opening balance edits apply immediately to all derived balances.
- Negative net balances are represented as `Advance` (never silently clamped away).

## Current UX Structure

Customers page is intentionally dashboard-first and compact:

1. **Inline compact form** (always visible)
   - Core row: name, phone, opening balance, status, actions
   - Optional details under `More details`
   - Edit from table reuses same form (no popup/modal)
2. **Compact summary strip**
   - Opening, Billed, Paid, Due/Advance, Last
3. **Customer list table**
   - customer identity and key financial columns
   - due/advance badge severity
   - detailed last activity block
   - row actions (`Edit`, `Activate/Deactivate`)

## Data Model and Optional Fields

Primary customer base fields:

- `name` (required, unique at DB level)
- `opening_balance`
- `active`

Optional long-term fields supported:

- `phone`
- `gstin`
- `address`
- `credit_limit`
- `note`

### Backward schema compatibility

`src/data/customers.ts` uses schema-fallback writes:

- First tries full payload with optional fields
- If server rejects unknown fields (older schema), retries with minimal payload:
  - `name`
  - `active`
  - `opening_balance`

This allows one codebase to run against mixed deployment schema states.

## Calculation Source of Truth

Customer ledger summary uses:

- `netBalance = openingBalance + billedTotal - paidTotal`
- `dueAmount = max(netBalance, 0)`
- `advanceAmount = max(-netBalance, 0)`

Bill totals are computed using shared billing math:

- sum `bill_items.amount` by bill
- apply `transport`
- apply GST with `calculateBillTotalFromBase(...)`

## Query and Sync Behavior

On create/update/toggle customer:

- invalidate `['customers-ledger']`
- invalidate dashboard query key (`DASHBOARD_QUERY_KEY`)

This keeps customers page + dashboard coherent without full reload.

## Robustness and Integrity Notes

- Form submit is blocked when customer name is empty.
- Form uses Zod validation before writes.
- Status text is announced with polite live-region semantics for accessibility (`aria-live`).
- Empty state includes direct CTA to add first customer.
- Due badges include severity color levels for quick risk scanning.

## Responsive and Scanability Choices

- Table remains horizontally scrollable on smaller screens to preserve numeric fidelity.
- Rows use zebra pattern and hover highlight for easier scanning.
- Numeric columns stay right-aligned with tabular/mono style for auditing.

## Known Trade-offs

- List uses full collection fetches (`getFullList`) for now; large datasets may later require pagination/server filtering.
- Historical snapshots (`customer_name`) are intentionally not backfilled on rename.

## Suggested Next Enhancements

- Add server-side pagination and filters in customers data loader.
- Add “aging buckets” (0-30, 31-60, 61+) for dues.
- Add customer detail drawer with bill/payment timeline and quick actions.
- Add optimistic UI on active toggle for faster interaction.

## Verification Checklist (latest run)

- `npm run test -- --run`
- `npm run typecheck`
- `npm run build`
- lints on changed customer files
