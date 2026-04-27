# New Payment Page Notes

This file documents the implemented `New Payment` page for future maintenance.

## Route and Modules

- Route UI: `src/routes/new-payment.tsx`
- Data access: `src/data/payments.ts`
- Ledger math: `src/domain/payment-ledger.ts`
- Tests: `src/domain/payment-ledger.test.ts`

## User Experience

- Single-page, clear workflow:
  - Payment details (date, customer, mode, amount, optional note)
  - Live summary (opening balance, outstanding before, payment applied, outstanding after)
  - Oldest-first adjustment preview table
- Modes are restricted to:
  - `Cash`
  - `Bank`
- Primary action:
  - `Save Payment`
- Secondary action:
  - `Clear`

## Validation Rules

- Uses Zod schema before save.
- Must have:
  - customer selected
  - valid `YYYY-MM-DD` date
  - payment amount > 0
  - mode in `{Cash, Bank}`

## Data Sources

From PocketBase:

- `customers`: `id`, `name`, `opening_balance`
- `bills`: used for due timeline
- `bill_items`: summed and merged with bill transport/GST to compute bill totals
- `payments`: historical payments and new payment writes

## Financial Logic

## Outstanding Baseline

- Bill totals are derived with shared billing math:
  - `calculateBillTotalFromBase(itemsTotal, transport, gstRate)`
- Customer running outstanding is based on:
  - `opening_balance + billed_total - paid_total`

## Oldest-First Allocation Preview

- Dues are ordered by:
  - bill date ascending
  - bill number ascending
- Opening balance is treated as the earliest due bucket when > 0.
- Historical payments are applied oldest-first first.
- Current form payment is then simulated against remaining dues oldest-first.

## Save Behavior

- On save, creates record in `payments` with:
  - `customer`
  - `customer_name`
  - `date`
  - `amount`
  - `mode`
  - `note`
- On success:
  - clears amount and note
  - invalidates dashboard query (`DASHBOARD_QUERY_KEY`)
  - invalidates page ledger query (`payment-ledger-context`) to refresh preview

## Reliability and Verification

- Unit tests included for:
  - oldest-first allocation
  - first-bill opening-balance handling
  - historical-payments-before-current-payment simulation
- Verification commands run:
  - `npm run test -- --run`
  - `npm run typecheck`
  - `npm run build`

## Future Enhancements

- Optional per-bill persisted allocation table (currently preview is computed, not persisted per bill).
- Optional payment receipt print/share template.
- Optional customer-wise payment history filter panel within New Payment.
