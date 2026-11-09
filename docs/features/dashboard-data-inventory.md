# Kapil Billing — Dashboard Data Discovery & Inventory

> **Status:** Verified Read-Only Audit · **Target:** 4 Dashboards (Main `/`, `/sales-dashboard`, `/purchase-dashboard`, `/casting`)  
> **Invariants:** 3-module isolation, no net combined positions, no cross-module stock coupling, Purchase in integer units.

---

## 1. Today's Dashboards & Existing Reports

| Route / Screen | Widget / Card | Loader / Domain Function | Collections & Key Fields Read | Period Scope | Visual / Chart Type | Known Problems / Gaps |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`/` (Main)** | Sales Receivables & Ageing | `useDashboardData` (`domain/dashboard.ts`) | `bills`, `payments`, `customers`, `bill_items` | All-time / As-of date | Stacked CSS bar (`AgingBar`) | `getFullList` unprojected; inline styles |
| | Sales MoM & FY Stats | `useDashboardData` | `bills.date`, `payments.date`, `amount` | Month / FY toggle | Text stats (`MonthStat`) | Inline delta math |
| | Sales vs Collections Trend | `useDashboardData` | `bills.date`, `payments.date` | Last 6 months | Recharts Line (`SalesCollectionTrendChart`) | Fixed 6M window |
| | Collect Next & Top Sold | `useDashboardData` | `bills`, `payments`, `bill_items.qty` | As-of date / Month | CSS ranked list (`RankedBarList`) | Hardcoded item checks in domain |
| | Purchase Pulse (4 Tiles) | `buildPurchaseDashboard` (`domain/purchase-dashboard.ts`) | `purchase_bills`, `supplier_payments`, `suppliers` | Month / FY / All-time | 4 Stat tiles (`InfoMetric`) | We-Owe tile double-counts advances |
| | Pay Next & Recent Purchase Bills | `purchaseBillsQueryOptions`, `suppliersSummaryQueryOptions` | `purchase_bills.in_no,netPaise`, `suppliers` | As-of date | Bordered item list | No direct chitty link |
| | Casting Cost Signal | `loadCastingSessions` (`data/casting.ts`) | `casting_sessions.wire_out,cost_per_kg,date` | Month / FY toggle | 2x3 Metric grid (`CostMetric`) | Chunked batch queries on load |
| **`/sales-dashboard`** | 4 Top KPI Cards | `useDashboardData` (`domain/dashboard.ts`) | `bills`, `payments`, `customers` | Current month & All-time | Simple link cards | No period picker |
| | Monthly Trend & Ageing | `useDashboardData`, `loadPartyDashboard` | `bills`, `payments`, `customers` | Last 6M / All-time | Recharts Line + ReportTable | Heavy unprojected queries |
| | Top Customers & Top Items | `loadPartyDashboard`, `useDashboardData` | `customers.dueAmount`, `bill_items.qty,amount` | Current month | Plain HTML `ReportTable` | Duplicate calculation of party due |
| **`/purchase-dashboard`**| Today Strip & Snapshot Tiles | `buildPurchaseDashboard` (`domain/purchase-dashboard.ts`) | `purchase_bills`, `supplier_payments`, `suppliers` | Today & All-time | Custom component cards | Missing month/FY selector |
| | Spend vs Paid Out | `buildPurchaseDashboard` | `purchase_bills.netPaise`, `supplier_payments` | Last 6 months | CSS dual-bar list (`SpendTrend`) | Fixed 6M window |
| | Pay Next & Material Matrix | `buildPurchaseDashboard` | `purchase_bill_lines`, `suppliers` | All-time | Custom data tables | Heavy full-collection read |
| **`/casting`** | 4 Operational KPI Panels | `loadCastingSessions`, `data/casting.ts` | `casting_sessions`, `casting_batches`, `casting_batch_inputs`| Current month & year | Lucide stat cards | Fetches 13 months on initial load |
| | 6M Trend, MoM, High/Low | `summarizeSessions` (`casting/index.tsx`) | `casting_sessions.wire_out,cost_per_kg` | Last 6 months | Plain HTML tables & signals | Inline math; trash restore drops batches |
| **`/monthly-report`** | Exec Company Report | `loadDashboardCollections`, `purchaseReadModelQueryOptions` | All Sales & Purchase collections | Fiscal Year | Recharts Gauges, Bars, Lines | Overlaps dashboard; redundant full fetch |
| **`/reports/*`** | Sales/Purchase/Casting subreports | `loadPartyDashboard`, `purchaseReadModelQueryOptions` | Module-specific collections | As-of date | Plain HTML tables (`ReportTable`) | Duplicate ageing & summary formulas |

---

## 2. Data Inventory per Module

| Module | Metric / Dimension | Source Collection & Fields | Already Computed Where | Compute Cost | Refresh | Status & Implementation Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Sales** | Billed Total (Month/FY) | `bills.date`, `bill_items.amount` | `domain/dashboard.ts` | Cheap | Live | **READY**: `thisMonthSummary.sales`, `fiscalYearSummary.sales` |
| | Collected Total (Month/FY) | `payments.amount`, `date` | `domain/dashboard.ts` | Cheap | Live | **READY**: `thisMonthSummary.collection` |
| | Outstanding Receivables | `customers.opening_balance`, `bills`, `payments` | `domain/records.ts:computeCustomerOutstanding` | Medium | Live | **READY**: `kpis.outstanding` |
| | Ageing Buckets (0-30/31-60/60+) | `bills.date`, `payments` | `domain/dashboard.ts:buildAgingBuckets` | Medium | Live | **READY**: `actionRequired.riskRows` |
| | Bill Statuses (Pending/Partial/Paid)| `bills`, `payments` | `domain/bills.ts:computeBillStatuses` | Medium | Live | **READY**: centralized FIFO in `bills.ts` |
| | Bills & Receipts per Day | `bills.date`, `payments.date` | `data/calendar-month.ts` | Cheap | Live | **READY**: loaded by calendar query |
| | Top Customers (Billed & Due) | `customers`, `bills`, `payments` | `domain/dashboard.ts`, `data/ledger.ts` | Medium | Live | **READY**: `loadPartyDashboard` |
| | Top Items (Bags & Kg) | `bill_items.item_name,qty,bags,amount` | `domain/dashboard.ts` | Cheap | Live | **READY**: `thisMonthItemBags`, `thisMonthItemReport` |
| | Average Bill Size | `bills.total` | `domain/dashboard.ts` | Cheap | Live | **READY**: `kpis.averageBillValue` |
| | Collection Days | `bills.date`, `payments.date` | `routes/monthly-report.tsx` (inline) | Medium | Live | **NEEDS DOMAIN FUNCTION**: Move from inline route to domain |
| | Market Rate vs Bill Rate | `bills.mkt`, lines, `brass_rates.vilaity` | None | Medium | Daily | **NEEDS DOMAIN FUNCTION**: Compare line rates with `brass_rates` |
| | GST & Transport Totals | `bills.gst_amount,transport` | None | Cheap | Live | **NEEDS DOMAIN FUNCTION**: Simple sum on bills |
| | Draft Backlog & Pending Counts | `bill_drafts`, `payment_drafts` | `data/bill-drafts.ts`, `data/payment-drafts.ts`| Cheap | Live | **READY**: `countPendingDrafts()`, `countPendingPaymentDrafts()` |
| | Inactive Customers (N days) | `customers.id`, `bills.date`, `payments.date` | None | Medium | Daily | **NEEDS DOMAIN FUNCTION**: Filter customers with no action in N days |
| | Brass Rate Trend (Vilaity) | `brass_rates.date,vilaity` | `data/suppliers.ts:loadVilaityHistory` | Cheap | Daily | **READY**: loads Vilaity history |
| **Purchase** | Procured Kg & Spend | `purchase_bill_lines.weight_g,amount_paise` | `domain/purchase-dashboard.ts` | Cheap | Live | **READY**: `snapshot.totalProcuredKg`, `totalProcuredPaise` |
| | Paid Out (Outgoing) | `supplier_payments.amount_paise,kind` | `domain/purchase-dashboard.ts` | Cheap | Live | **READY**: `snapshot.totalPaidPaise` |
| | Payable per Pool (Kacha / GST) | `suppliers`, bills, payments | `domain/supplier-settlement.ts` | Medium | Live | **READY**: `pools.kacha.outstandingPaise`, `pools.gst.outstandingPaise` |
| | Advance Held | `supplier_payments`, `purchase_bardan` | `domain/purchase-dashboard.ts` | Medium | Live | **READY**: `snapshot.totalAdvancePaise` |
| | Payable Ageing | `purchase_bills.date,duePaise` | `domain/purchase-dashboard.ts` | Medium | Live | **READY**: `snapshot.aging` (0-30, 31-60, 60+) |
| | Supplier Ranking (Pay Next) | `suppliers`, dues | `domain/purchase-dashboard.ts:payNext` | Cheap | Live | **READY**: sorted by oldest due and outstanding |
| | Item-wise Kg & Average Rate | `purchase_bill_lines.item_name,weight_g,rate_milli`| `domain/purchase-dashboard.ts` | Cheap | Live | **READY**: `gradeRows` in purchase dashboard |
| | Item Rate Trend vs Vilaity | `purchase_bill_lines.rate_milli`, `brass_rates` | `routes/reports/purchase.tsx` (inline) | Medium | Daily | **NEEDS DOMAIN FUNCTION**: Move premium calculation to domain |
| | Bardan Pending (Count & Days) | `purchase_bills.bardanPending,date` | `domain/purchase-dashboard.ts` | Cheap | Live | **READY** (count); **NEEDS DOMAIN FUNCTION** for days old |
| | RCM Liability Total | `purchase_bills.tax_mode='rcm'`, lines | `domain/supplier-purchases.ts:computeBillNet` | Cheap | Live | **READY**: `rcmLiabilityPaise` |
| | Adjustments Totals | `purchase_bill_adjustments.type,amount_paise` | `domain/supplier-purchases.ts:computeBillNet` | Cheap | Live | **READY**: grouped by labour, transport, quality_cut |
| | Settle-offs & Non-Cash Credits | `supplier_payments.kind='settle_off'` | `domain/purchase-log-metrics.ts` | Cheap | Live | **READY**: classified by `supplierPaymentActivity` |
| | Bills by Status (Open/Part/NIL) | `purchase_bills.duePaise,cancelled` | `domain/purchase-read-model.ts` | Cheap | Live | **READY**: computed per bill in read model |
| **Casting** | Sessions Count | `casting_sessions.id,date` | `data/casting.ts:loadCastingSessions` | Cheap | Live | **READY**: `monthSessions.length` |
| | Input Kg by Material | `casting_batch_inputs.material_name,qty` | `routes/casting/index.tsx` (inline) | Cheap | Live | **READY**: mapped from session inputs |
| | Wire Output & Wastage % | `casting_sessions.wire_out,wastage,total_input_kg`| `routes/casting/index.tsx` | Cheap | Live | **READY**: `monthStats.wire`, `monthStats.wastage` |
| | Chol In Total | `casting_sessions.chol_in` | `casting_sessions` collection | Cheap | Live | **READY**: stored directly on session |
| | Fuel & Labour Costs | `casting_sessions.coal_kg,coal_rate,worker_salary`| `routes/casting/index.tsx` | Cheap | Live | **READY**: `totalCoalKg`, `totalWorkerSalary` |
| | Cost per Kg (Metal vs Loaded) | `casting_sessions.cost_per_kg,finalProductCostPerKg`| `routes/casting/index.tsx` | Cheap | Live | **READY**: `avgCostKg` (metal), `avgLoadedCostKg` (loaded) |
| | Monthly Yield / Cost Trend | `casting_sessions.date,wire_out,cost_per_kg` | `routes/casting/index.tsx:monthlyTrend` | Cheap | Live | **READY**: 6-month trend array |
| | Batches per Session | `casting_batches.session` | `routes/casting/index.tsx:monthStats.batches` | Medium | Live | **READY**: counted from batch chunks |
| | Best & Worst Session Signals | `casting_sessions.cost_per_kg` | `routes/casting/index.tsx:sessionSignals` | Cheap | Live | **READY**: minimum & maximum cost sessions |
| **Shared** | Market Rates (Vilaity / Honey) | `brass_rates.date,vilaity,honey_gulf` | `data/suppliers.ts`, `data/casting.ts` | Cheap | Daily | **READY**: historical lookup & monthly averages |
| | Module Switches | `app_settings.purchase_enabled,casting_enabled`| `data/module-settings.ts` | Cheap | Static | **READY**: cached in `useModuleSettings()` |

---

## 3. Time, Comparison & Scale

- **Pickers & Time Windows Today:** Handled via `selectedMonth` (`YYYY-MM`) and `fiscalYearStart(month)` (`YYYY-04-01`). Routes use `getLocalIsoDate()`. `MonthPicker` component exists in `@/components/ui/business-kit`.
- **Existing Comparisons:** "Vs last month" exists for Sales (`kpis.salesVsLastMonth`), Purchase (`totalProcuredKg - prevKg`), and Casting MoM (`previousMonthStats`). "Vs same month last year" (YoY) does NOT exist in loaders.
- **Row Counts Today & 3-Year Growth:**
  - *Current Active Volume:* Sales: ~600 bills, ~800 receipts, ~120 customers. Purchase: ~150 bills, ~200 payments, ~15 suppliers. Casting: ~30 sessions, ~120 batches. Total: ~2,000 core records.
  - *3-Year Expected Volume:* Sales: ~3,000 bills, ~4,500 receipts. Purchase: ~1,500 bills, ~2,500 payments. Casting: ~150 sessions, ~600 batches. Total: ~15,000–25,000 records.
- **Data Loaders & Query Patterns:**
  - `loadDashboardCollections` (`data/dashboard.ts`): calls `getFullList()` on all 5 Sales collections with **no date filter and no field projection**.
  - `loadPurchaseReadModel` (`data/suppliers.ts`): calls `fetchAll()` on all 6 Purchase collections. TanStack Query caches under `['purchase-read-model']` with `staleTime: 60_000`.
  - `loadCastingSessions` (`data/casting.ts`): uses date filters (`date >= from && date <= to`), but chunks batch and input queries in batches of 30 IDs.
  - `loadCalendarMonthData` (`data/calendar-month.ts`): uses strict date filters for the target month.
- **First Paint Hazards:** Triggering unprojected `getFullList` across all Sales and Purchase tables on initial dashboard load creates 15+ concurrent requests and locks the main thread during FIFO allocation.

---

## 4. Existing Visuals & Kit Components

- **Chart Libraries in Use:** `recharts` (`LineChart`, `BarChart`, `RadialBarChart`, `ResponsiveContainer`) in `src/components/reports/company-charts.tsx`.
- **Custom Visual Helpers:** `KpiSparkline` (SVG polyline in `company-charts.tsx`), `SpendTrend` (pure CSS dual-bar in `components/purchase-dashboard/spend-trend.tsx`), `AgingBar` (CSS stacked bar in `routes/index.tsx`), `RankedBarList` (`components/ui/business-dashboard.tsx`).
- **Kit Components Reusable for Dashboards:** `KpiCard` (`business-kit.tsx`), `StatusChip` (`status-chip.tsx`), `MoneyCell` (`money-cell.tsx`), `DataTable` (`data-table.tsx`), `MonthPicker` (`business-kit.tsx`), `SectionCard` / `Panel` (`business-kit.tsx`, `panel.tsx`), `StatusPill` (`business-dashboard.tsx`).
- **Missing Kit Primitives:** Standalone Sparkline component, reusable horizontal stacked bar, dedicated DeltaChip/Pill (`+₹X vs last month`), and promotion of `RankedBarList` from `business-dashboard` to `business-kit`.

---

## 5. Architectural Proposal (Based on READY / Cheap Data)

### Main Dashboard (`/`) — Executive Operational Pulse
- **Max 8–10 Glance Items; Strictly Isolated; Synchronized Month Selector:**
  1. **Header Controls:** Single `MonthPicker` + Period Toggle (`Month` \| `FY to Date`) driving all three module pulse blocks.
  2. **Sales Pulse Card:** Billed (₹), Collected (₹), Outstanding Receivables (₹) + own MoM delta.
  3. **Purchase Pulse Card:** Bought Metal (kg), Paid Out (₹), Still We Owe (₹, Kacha/GST split) + own MoM delta.
  4. **Casting Pulse Card:** Wire Output (kg), Wastage %, Weighted Loaded Cost / kg (₹) + own MoM delta.
  5. **Needs Your Attention Unified Panel:** Overdue customers (>45d), Pay Next suppliers, Bardan pending >10d, Pending drafts count, Stale brass rate warning (>3 days old).
  6. **Latest Transactions Split:** Side-by-side feed of Latest 5 Sales Invoices and Latest 5 Purchase Bills (with direct link to chitty).
- **⛔ NEVER APPEAR:** No combined net position, no cross-module cash balance, no customer/supplier netting.

### Specialized Module Dashboards
- **Sales Dashboard (`/sales-dashboard`):**
  - *5 KPIs:* Billed (₹), Collected (₹), Outstanding (₹), Avg Bill Value (₹), Active Buying Parties.
  - *3 Charts:* Sales vs Collections 6M (LineChart), Receivable Ageing Buckets (Stacked Bar), Monthly Bill & Bags Volume (BarChart).
  - *2 Ranked Lists:* Top Customers by Outstanding, Top Sold Items by Volume.
  - *3 Quick Actions:* + New Bill, + Record Payment, Export Statements.
- **Purchase Dashboard (`/purchase-dashboard`):**
  - *5 KPIs:* Procured Metal (kg), Procured Spend (₹), Paid Out (₹), We Owe (split Kacha/GST) (₹), Bardan Pending (Bills count).
  - *3 Charts:* Spend vs Paid Out 6M (Dual BarChart / CSS `SpendTrend`), Material Intake Volume Breakdown (Ranked Bar), Grade Rate Trend vs Vilaity (LineChart).
  - *2 Ranked Lists:* Pay Next (Suppliers by payable & age), Top Materials Procured.
  - *3 Quick Actions:* + New Purchase Bill, + Record Supplier Payment, Settle Bardan Bags.
- **Casting Dashboard (`/casting`):**
  - *5 KPIs:* Wire Output (kg), Metal Input (kg), Wastage % (burning loss), Weighted Rod Cost / kg (₹), Active Foundry Days.
  - *3 Charts:* Wire Out & Wastage % 6M Trend (Bar/Line combo), Raw Material Charge Mix (Stacked/Ranked Bars), Production Cost vs Vilaity Benchmark (LineChart).
  - *2 Ranked Lists:* Lowest Cost Heats (Best signals), Highest Wastage / High Cost Heats.
  - *3 Quick Actions:* + New Casting Session, View Foundry Heats Log, Generate Casting Bill.
- **First Paint Budget:** KPIs and Pulse cards load in Phase 1 (<200ms) from existing cached query models. Recharts trend charts and detailed lists load in Phase 2 deferred paint.

---

## 6. Risks, Discrepancies & Formula Duplication

1. **Purchase "We Owe" Ambiguity:** `purchase-dashboard` computes net payable (`max(0, outstandingPaise)`), whereas `purchase-bills` sums gross bill `duePaise`. Advance chips are double-counted if shown alongside net debt. (Resolved in Step 1 by `computeSupplierPositions`).
2. **Duplicated Calculation Logic:** Ageing bucket math was copy-pasted across 4 routes. (Resolved in Step 1 by `computeAgeingBuckets` in `domain/records.ts`).
3. **Casting Trash/Restore Defect:** `routes/casting/log.tsx` (line 297) and `domain/casting-trash.ts` only capture top-level session fields and flat material inputs. When a session is deleted, associated `casting_batches` records are purged. Restoring via `saveCastingSession` recreates the session without any batches, permanently corrupting batch-level and material-usage metrics. *Proposed Fix:* Update `CastingTrashSnapshot` to serialize full `batches: Array<{ batchNumber, wireOut, mel, inputs }>` and make restoration write to both `casting_sessions` and `casting_batches`, or add an `is_deleted: bool` field to `casting_sessions`.
4. **Unprojected Sales Queries:** `loadDashboardCollections` fetches all historical bill items. Must be scoped to date ranges or fields projections as database reaches 3-year volume.

---

## 7. Open Questions for Owner Alignment

1. **Comparison Default:** Compare against previous month (MoM) or same month last year (YoY)? *(Recommended: MoM for monthly pulse; YoY toggle for FY).*
2. **Casting Headline:** Primary foundry signal as Wastage Loss % or Weighted Loaded Cost / kg? *(Recommended: Weighted Loaded Cost / kg).*
3. **Attention Triggers:** Urgency thresholds for parties & bardan? *(Recommended: Customer bill > 45d, Supplier due > 30d, Bardan pending > 10d, Drafts > 3d).*
4. **Main Dashboard Layout:** 3 module pulses as 3 horizontal columns or stacked full-width cards? *(Recommended: 3 horizontal responsive cards).*
5. **Chart Engine:** Lightweight CSS/SVG bars (instant load like `SpendTrend`) vs interactive Recharts? *(Recommended: CSS/SVG for Main pulse; Recharts for deep-dives).*
6. **Bardan Valuation:** Show Bardan pending strictly as count of bills/bags or estimate rupee value? *(Recommended: Bill & bag count only; avoids synthetic estimates).*
