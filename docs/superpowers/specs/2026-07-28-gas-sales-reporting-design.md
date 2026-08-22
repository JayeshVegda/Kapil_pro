# Gas Sales Reporting Design

## Objective

Improve Kapil Pro's sales reporting without expanding into purchases, inventory accounting, expenses, or profit-and-loss reporting. The work focuses on gas bills and helps the operator understand selling rates, market-rate differences, customer performance, and sales timing.

## Scope

The implementation covers two reporting surfaces:

1. `/monthly-report`, presented as **Company Report**
2. `/monthly-sales-calendar`, presented as **Monthly Sales Calendar**

The existing `/calendar` URL remains available as a compatibility redirect to `/monthly-sales-calendar`. The main dashboard is outside this phase except for navigation links that must point to the renamed calendar route.

## Data Sources

Use existing PocketBase collections and existing data-layer patterns:

- `bills`: customer, date, bill market rate, tax, transport, and bill identity
- `bill_items`: item, item name, quantity, bags, rate, and amount
- `items`: item metadata used to identify gas billing items
- `payments`: collection activity
- `customers`: customer identity and opening balance
- `brass_rates`: historical Vilaity market rates where calendar-level market context is needed

Gas lines must be identified through the existing billing-mode helper rather than item-name guesses. Financial calculations belong in `src/domain`; PocketBase access remains in `src/data`; route files orchestrate presentation.

## Metric Definitions

All gas-selling rates use weighted calculations so large bills contribute proportionally.

- **Gas sales before tax and transport**: sum of `bill_items.amount` for gas lines
- **Gas quantity**: sum of gas-line `qty`, expressed in kilograms
- **Gas bags**: sum of gas-line `bags`
- **Weighted average selling rate**: gas sales before tax and transport divided by gas quantity
- **Weighted average market rate**: sum of each gas line's quantity multiplied by its parent bill's saved `mkt` rate, divided by gas quantity
- **Premium/discount per kg**: weighted average selling rate minus weighted average market rate
- **Premium/discount percentage**: premium/discount per kg divided by weighted average market rate, multiplied by 100
- **Customer sales share**: a customer's gas sales divided by total gas sales for the selected period

Rows with zero or missing quantity do not contribute to rate denominators. Rows with a missing or zero market rate contribute to selling metrics but not market-rate comparison denominators. The UI shows unavailable comparisons as `—`; it does not silently treat missing market rates as zero.

The report must distinguish:

- gas line sales, used for selling-rate analysis
- full invoiced sales including GST and transport, used by the existing company financial summary

## Company Report

The existing company report retains its sales, collections, receivables, aging, financial-year comparisons, and customer follow-up tools.

A new **Gas Sales Performance** section leads the sales-analysis portion and supports a selected reporting period, initially defaulting to the current month. It contains:

- gas sales amount
- kilograms and bags sold
- weighted average selling rate
- weighted average market rate
- premium or discount per kg and percentage
- month-over-month changes for gas sales, kilograms, bags, and weighted selling rate

The section includes:

1. A monthly trend comparing weighted selling rate with weighted bill market rate, with gas kilograms available as context.
2. An item table showing item name, gas sales, kilograms, bags, weighted selling rate, weighted market rate, and premium/discount.
3. A customer table showing customer, gas sales, share, kilograms, bags, bill count, weighted selling rate, weighted market rate, and premium/discount.

Tables default to the most decision-useful order: gas sales descending for customers and gas kilograms descending for items. Customer rows link to Party Ledger.

## Monthly Sales Calendar

The existing calendar functionality moves from `/calendar` to `/monthly-sales-calendar`. Its page and navigation label become **Monthly Sales Calendar**.

The monthly overview adds:

- gas sales
- gas kilograms and bags
- weighted selling rate
- weighted market rate
- premium/discount per kg
- leading gas item for the month

Each calendar day can show:

- full invoiced sales
- collections
- gas kilograms and bags
- weighted gas selling rate
- saved market rate
- premium/discount per kg

The selected-day sidebar retains bill and payment details and adds a compact gas-selling summary when gas lines exist for that day.

## Navigation and Compatibility

- Sidebar: `Company Report` links to `/monthly-report`.
- Sidebar: `Monthly Sales Calendar` links to `/monthly-sales-calendar`.
- App-shell titles and quick navigation use the same labels.
- `/calendar` redirects to `/monthly-sales-calendar`, preserving the selected month query parameter when present.
- Internal links are updated to the canonical route.

## Visual Direction

Follow the existing slate/blue Kapil Pro design:

- compact white panels and subtle dividers
- tabular number alignment
- restrained green for premium and red for discount
- charts only where comparison across time is clearer than a table
- audit-friendly tables remain available below summaries
- responsive horizontal overflow for detailed tables

No dashboard-template redesign or decorative metric-card expansion is included.

## Error and Empty States

- Existing query error states remain intact.
- A period without gas lines shows a clear “No gas sales in this period” state while non-gas company metrics continue to render.
- Missing market data is labeled as unavailable without suppressing valid selling data.
- Mixed gas and non-gas bills contribute only their gas lines to gas-rate analytics.

## Verification

Domain tests cover:

- weighted selling-rate calculation across unequal quantities
- weighted market-rate calculation
- missing and zero quantities
- missing market rates
- mixed gas and non-gas lines
- item, customer, day, and month grouping
- premium/discount calculations

Application verification covers:

- TypeScript typecheck
- unit tests
- production build
- `/calendar` redirect and month-query preservation
- Company Report desktop and mobile layouts
- Monthly Sales Calendar desktop and mobile layouts
- cross-checking displayed totals against representative bill lines

## Explicitly Excluded

- purchases and supplier reporting
- inventory valuation
- general expenses
- gross or net profit
- P&L, balance sheet, and accounting cash-flow statements
- material dashboard redesign
