# Company Report Page Detailed Notes

## Purpose

The Company Report page (`/monthly-report`) is the management-level analytics view for business-wide performance.
It is intentionally separate from Party Ledger:

- **Company Report**: macro view (sales, collections, efficiency, aging, trends, FY analysis)
- **Party Ledger**: customer-level operational follow-up and statement details

Primary implementation file: `src/routes/monthly-report.tsx`.

## Data Flow

### Source collections

The page loads raw data from:

- `bills`
- `bill_items`
- `payments`
- `customers`
- `items`

Using:

- `loadDashboardCollections()` from `src/data/dashboard.ts`

### Main derived maps

The page builds and reuses these aggregations:

- `itemSumByBill`: bill item amount sum by bill ID
- `itemBagsByBill`: bags sum by bill ID
- `dailySalesMap`: sales by date (YYYY-MM-DD)
- `dailyBagsMap`: bags sold by date
- `monthlyMap`: `{ sales, collections }` by month key (`YYYY-MM`)
- `customerSalesMap`: lifetime sales by customer
- `customerOutstandingMap`: current outstanding by customer (opening + billed - paid)
- `customerLatestBillDate`: last bill date by customer (for aging bucket classification)

## Key KPI Definitions

### Gas Sales Performance

- **Gas Sales**: sum of gas `bill_items.amount`, excluding GST and transport
- **Weighted Average Selling Rate**: gas line amount divided by gas quantity in kg
- **Weighted Bill Market Rate**: each gas line's kg multiplied by its parent bill's saved `mkt` rate, divided by kg with valid market rates
- **Premium / Discount per kg**: weighted selling rate minus weighted bill market rate
- Breakdowns are available by month, item, and customer
- Electronic item lines do not contribute to gas metrics
- Missing market rates are shown as unavailable rather than treated as zero

### Executive Summary

- **Total Sales**: sum of all bill totals (base + transport + GST)
- **Total Collections**: sum of all payment amounts
- **Receivable**: sum of positive outstanding balances across customers
- **Customer Advance**: absolute sum of negative outstanding balances
- **GST Estimate**: aggregated GST portion from billed items
- **Collection Efficiency (of billed)**: `totalCollections / totalSales * 100`
- **Collection Efficiency Delta**: this month efficiency minus last month efficiency (percentage points)
- **Avg Collection Days (DSO estimate)**: `receivable / avgDailySales(last 30 days)`

### Period Comparison

- Month deltas are explicitly **vs last month**
- FY numbers follow Indian FY boundaries (Apr-Mar)

### Financial Year Cards (3 FYs)

For current FY and previous 2 FYs:

- Sales
- Collections
- Gap (`max(0, sales - collections)`)

## Receivable Aging Logic

Aging buckets:

- `0-30`
- `31-60`
- `61-90`
- `90+`

Classification basis:

- Uses customer-level outstanding amount > 0
- Uses days since that customer's latest bill date

### Drill-down behavior

Each bucket is clickable and shows:

- customer name
- due days
- bucket amount
- quick action to open Party Ledger for that customer

Action CTA:

- **Collect from overdue parties** -> navigates to Party Ledger with overdue focus

## GitHub-Style Daily Heatmap

### Scope

- Last 365 days
- 1 cell per day
- week columns, weekday rows, month labels

### Color semantics

- 0 sales: neutral gray
- low to high sales: light to dark green

### Hover details

Tooltip includes:

- date
- sales amount
- bags sold

### Robustness details

- Grid start aligned to Sunday, end aligned to Saturday for clean full-week columns
- Column count is computed dynamically from actual week count (no hard-coded 53-column assumption)
- Supports variable ranges safely

## Navigation Decisions

Sidebar naming/grouping updated for clarity:

- `Party` renamed to `Party Ledger`
- `Company` renamed to `Company Report`
- `Party Ledger` moved under Customers group

## Responsive Behavior

- Sections use adaptive metric grids (`1 -> 2 -> 3/4/6 columns`)
- Heatmap is wrapped in horizontal overflow for small screens
- Heatmap container uses subtle panel styling for readability on large screens

## Known Trade-offs

- All aggregation is in-memory from full collections; acceptable for current scale, may need server-side aggregation/pagination for larger datasets.
- Aging uses latest bill date as due-age proxy; if explicit due-date terms are introduced later, switch bucket logic to true due-date fields.

## Extension Recommendations

1. Add report filters for:
   - date range presets
   - branch/customer segments
2. Add metric mode for heatmap:
   - sales / collections / bill count
3. Add export:
   - CSV for aging drilldown list
   - PDF snapshot for management reporting
4. Add cached summary endpoint if dataset grows

## Verification Checklist

After any change to this page:

1. `npm run build`
2. Validate:
   - Executive summary values
   - Month delta labels (must show vs last month)
   - Aging bucket click -> drilldown list
   - Aging CTA -> Party Ledger overdue focus
   - Heatmap hover shows sales + bags
   - Mobile horizontal scroll for heatmap
