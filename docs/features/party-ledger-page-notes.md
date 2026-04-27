# Party (Ledger) Page Detailed Notes

## Purpose

The Party page (`/ledger`) is a single-party analytics dashboard designed for daily collection decisions and historical review.
It shows a selected customer's financial health, billing/collection trends, and full running statement in one place.

Primary file: `src/routes/ledger.tsx`

## Product Intent

- Keep workflow simple: select party -> read core numbers -> check trend -> inspect statement.
- Always support due and advance customers (negative balances are valid and intentional).
- Make quick risk calls (overdue, collection lag, no recent payments) without opening other pages.

## Data Sources and Layering

### Route Layer

- `src/routes/ledger.tsx`
  - Renders dashboard sections and UI state.
  - Runs queries and derives presentational analytics.

### Data Layer

- `src/data/ledger.ts`
  - `loadPartyDashboard(asOfDate, overdueDaysThreshold)`: loads all customers/bills/items/payments and builds per-customer rows.
  - `loadPartyStatement(customerId, asOfDate)`: loads selected customer statement events.

### Domain Layer

- `src/domain/ledger.ts`
  - `buildPartyRows(...)`: per-customer aggregates and status classification.
  - `buildPartyKpis(...)`: global KPI aggregation (kept for reuse).
  - `buildPartyEvents(...)`: ordered opening/bill/payment timeline with running balance.

## Core Matrix Definitions

The top matrix on Party page is computed from `PartyRow`:

- `openingBalance`: customer opening carry-forward.
- `billCount`: number of bills up to `asOfDate`.
- `billedTotal`: total bill amount including transport + GST.
- `paidTotal`: total payments collected.
- `dueAmount`: positive outstanding.
- `advanceAmount`: positive advance bucket for overpayment.
- `totalBags`: sum of item bags.
- `totalWeight`: sum of item quantity/weight.
- `totalTransport`: sum of bill transport.
- `totalGst`: sum of GST amount from bill items.
- `averageSellingRate`: `totalItemAmount / totalWeight` (0 when weight is 0).
- `averageSellingWeight`: `totalWeight / billCount` (0 when billCount is 0).

## Status and Risk Logic

Per customer status from domain:

- `Clear`: no due and no advance.
- `Advance`: net balance < 0.
- `Pending`: due > 0 and below overdue threshold window.
- `Overdue`: due > 0 and days since latest bill/activity >= threshold.

Quick health model in route:

- Health status: `Good | Risk | Overdue`
- Risk signals include:
  - high unpaid due,
  - stale payment recency,
  - billing growth outpacing collection.

## Monthly Report Logic

Derived from statement events:

- This month billing/collection.
- This year billing/collection.
- Highest bill, highest payment.
- Average monthly billing/collection (last 6 active months).
- 6-month compact trend (`YYYY-MM`, debit, credit, gap).
- Peak billing and collection months in trend window.

## Statement Section Behavior

- Filters: `All`, `Bills`, `Payments`.
- Pagination: 20 rows/page with Prev/Next.
- Scrollable container with sticky header.
- Running balance shown with semantic suffix:
  - `X Due` for positive,
  - `X Advance` for negative.
- Print/Export opens browser print window with full statement.

## Robustness and Empty States

Implemented protections:

- Empty dashboard state when no party data exists.
- Empty filtered statement state.
- Pagination auto-resets when filter/customer changes.
- Pagination clamps when page count shrinks.
- No-payment customers marked `Irregular` (not incorrectly `On-time`).

## Responsiveness Notes

- Metric grids are mobile-first (`1 -> 2 -> 4/6` columns depending on section).
- Statement table uses horizontal scroll for narrow viewports.
- Header controls use wrapping layout to avoid overflow on small screens.

## Known Trade-offs

- `loadPartyDashboard` and statement aggregation currently use in-memory grouping after full list fetch; acceptable for low-medium volume but should be optimized if data grows significantly.
- Statement print currently includes full statement events (not current filter/page), which is useful for auditing but may differ from what is visible on screen.

## Extension Points (Recommended Next)

- Add server-side pagination/filtering for very large statements.
- Add CSV export for current filter and page.
- Add optional date-range mode (disabled currently by product request).
- Add chart components (sparkline/bar) for trend if visual analytics should be richer.
- Add party-level cached summary snapshots for faster first paint on large datasets.

## Quick Verification Checklist

Run after edits:

1. `npm run build`
2. `npm run test -- src/domain/ledger.test.ts`
3. Verify UI states manually on `/ledger`:
   - No data state
   - Due customer
   - Advance customer
   - Statement filters + pagination
   - Mobile width scroll/readability

