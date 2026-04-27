# New Bill Page Notes

This document captures the implemented behavior of the `New Bill` page for future maintenance.

## Location

- Route: `src/routes/new-bill.tsx`
- Save helper: `src/data/bills.ts`
- Totals logic: `src/domain/billing-calculations.ts`

## Current Capabilities

- Create a bill with:
  - Book No, Bill No, Date, Customer
  - Market (MKT) rate
  - Transport (optional)
  - GST (optional)
  - LR numbers (optional)
  - Multiple item rows (item, qty, rate)
- Pre-save preview modal with:
  - Professional temporary bill layout
  - Print support
  - JPG export support
  - Confirm-and-save action
  - WhatsApp share action

## Validation and Safety

- Form validation is schema-based using Zod.
- Bill save is done through `saveBillWithItems(...)`.
- Item creation failure triggers rollback (best-effort delete of created bill/items).
- PocketBase auto-cancel behavior is disabled in client setup to avoid aborted writes.

## Financial Calculation Rules

## 1) Current Bill Total

- Computed from valid item rows:
  - Row amount = `qty * rate`
- Then adjustments:
  - `+ transport`
  - `+ gstAmount` (only when GST > 0)
- Source of truth: `calculateBillTotals(...)`.

## 2) Previous Balance (Auto)

- Query key: `['customer-auto-balance', customerId, date]`
- Data source: `customers`, `bills`, `bill_items`, `payments`
- Rule:
  - If customer has prior bills before current bill date:
    - previous balance = `opening_balance + billed_till_previous_bill - paid_till_previous_bill`
  - If no prior bill exists:
    - previous balance = customer `opening_balance`

## 3) Credit Entries (Auto, Date Windowed)

- Credits are payments for selected customer in this strict window:
  - `payment.date > previousBillDate`
  - `payment.date <= currentBillDate`
- Only positive payment amounts are included.
- This avoids mixing historical or future payments.

## 4) Sub Total and Amount Due

- `Sub Total = Previous Balance + Current Bill Total`
- `Amount Due = Sub Total - Total Credits`

## Preview Layout Intent

- Designed as a clean, client-friendly temporary bill (not final tax invoice).
- Includes:
  - Company name
  - Bill reference and date
  - Customer name (`M/s.`)
  - Item ledger table
  - Current Bill Total, Sub Total, Amount Due
  - Previous balance and credits context
  - Dispatch footer (weight, bags, LR no, signature area)

## WhatsApp Share

- Opens `wa.me` with encoded summary text.
- Included fields:
  - Company name
  - Bill reference
  - Party name
  - Bill date
  - Current bill
  - Previous balance (with reference date)
  - Payments adjusted
  - Amount due

## Operational Notes

- Use preview server for stable testing when dev HMR feels noisy:
  - `npm run build`
  - `npm run preview -- --host 0.0.0.0 --port 4173`
- If UI looks stale in browser, hard refresh once (`Ctrl+Shift+R`).

## Future Improvements (Recommended)

- Move company name to env/config (`VITE_COMPANY_NAME`).
- Add explicit customer ledger page (currently placeholder routes).
- Persist and display running closing balance history per bill.
- Add dedicated tests for:
  - first-bill opening-balance case
  - payment window boundaries
  - Sub Total / Amount Due math
