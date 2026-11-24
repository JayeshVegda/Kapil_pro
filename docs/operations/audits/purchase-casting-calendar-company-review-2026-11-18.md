# Purchase, Casting, Calendar and Company Report review

18 November 2026. Source review only. This report records confirmed code behavior and proposed changes. No application code or live records were changed. The specific customer payments reported as overdue were not reconciled against live records.

## 1. Purchase and bardan

| Finding | What the code does today | Proposed behavior |
| --- | --- | --- |
| Empty Bardan column | The desktop and print chitty table always renders a Bardan column. The receipt memo formatter turns numeric text such as `0` into `0 bags`. Mobile renders bardan only when there is display text. | Use one visibility rule for preview, screen and print. Hide the material-table column when there is no positive recorded count or meaningful line-level bardan. On mixed bills, leave unrelated lines blank. Keep confirmed settlement details visible in their own section, even without a receipt count. |
| Add Bardan takes too many steps | A saved bill detail already has Add Bardan. The shared table supports an optional action and the dashboard has an entry point, but the purchase bill list action group needs the same direct action. The existing modal starts at the first purchase line rate, does not show bag count and exposes method, date and note up front. | Reuse one modal from the bill list, detail and dashboard. Show **Bags**, **Bardan weight (kg total)** and **Rate (₹/kg)**. Prefill count from the receipt and the rate from its matching bill line. Focus weight. Show the credit and revised bill payable before confirmation. Put date, note and alternate settlement methods under More options. |
| Pending includes bills with no bags | Settlement and read-model fallback mark any uncancelled bill with no bardan entry as pending. One existing entry clears the flag regardless of whether all bags were settled. | Use explicit states such as **No bardan**, **Unknown**, **Pending**, **Partially settled** and **Settled**. Pending requires positive recorded bardan or a deliberate expectation. Treat ambiguous older records as Unknown and keep them out of the pending KPI. Drive dashboard, lists, supplier ledger and reports from the same rule. Keep financial due separate from physical bardan due. |
| New Purchase collects a memo, not a normal settlement | The manual editor saves line receipt memos. The inline settlement form and the create payload’s bardan entries are currently tied to Muse drafts. | Add an expandable, directly editable Bardan section on New Purchase. Reuse its fields, calculation and validation in the modal. Let the operator save a receipt count now and settle later, or confirm settlement with the new bill when weight is known. |
| Renamed item still shows the old name | Purchase lines store the item ID and a saved `item_name` string. Readers such as the purchase line mapper use the stored text, so refreshing cannot change it. Some older lines have a name but no linked ID. | Resolve the current master label by ID in operational views and search, with the saved label as fallback. Preserve the original name on historical chitties and avoid matching unlinked rows by name. If printed historical bills should display the current label, approve that as a separate choice. |

### Proposed workflow and safeguards

1. Open **Add Bardan** on an active bill. For multiple bardan lines, show each line's item, count and saved rate. When the source is ambiguous or rates differ, ask the operator to choose the line. A saved first line rate is not a reliable default in that case.
2. Enter total bag weight. Preview **weight × rate = credit**, plus net payable and the resulting balance after payments. Confirm once. Use the existing purchase calculation in grams, milli-rupees and paise, including its rounding rules.
3. Refresh the chitty, bill, supplier ledger and pending totals together. Preserve the four settlement methods and the existing Kacha/GST pool boundary. Show any overpayment as an advance or credit under the existing rules. Prevent duplicate entries from repeated confirmation and reject changes to voided bills.

Receipt count, settlement weight and settlement credit are separate facts. Existing per-line receipt notes can contain text, and the separate receipt-weight note records kg. Neither should be treated automatically as a settled bag count. If partial settlement must be tracked reliably, store settled count explicitly alongside the weight and rate. Do not infer how many physical bags were returned from kg alone.

“Resize” is interpreted here as expanding the inline editor so bardan can be edited directly. If it means reweighing or entering a revised quantity, that should be specified before implementation.

Source anchors: `src/components/suppliers/bill-chitty.tsx:229`, `src/components/suppliers/bill-modals.tsx:38`, `src/routes/purchase-bills/index.tsx:699`, `src/domain/supplier-settlement.ts:338`, `src/domain/purchase-read-model.ts:149`, `src/components/suppliers/purchase-bill-editor.tsx:1053`, and `src/data/suppliers.ts:257`.

## 2. Casting chitty

The ticket currently shows material detail, furnace and labour detail, an output block that repeats headline facts, and the formula breakdown before the final rate. Move **Final ready cost/kg** to the top beside wire out. Keep one compact materials table and a short A/B/C breakdown. Use the same hierarchy in the on-screen and printed chitty.

The current code already selects the new formula for version 2: **metal/kg + 2 × (chitty Brass rate × 7%) + 2 × coal per wire-out kg + 2 × wages per wire-out kg**. A stored version of 1 or a missing version follows the original formula. That explains why old tickets can still show the old rule. If a newly saved ticket does it as well, check whether the deployed database has the version field and whether the session saved as version 2. The live state was not checked for this report.

Recommended: use version 2 consistently for new sessions. Changing old chitties would restate historical costs, so decide separately whether to keep the original rate or show a clearly labelled recalculation alongside it.

Source anchors: `src/components/casting/casting-ticket.tsx:43`, `src/data/casting.ts:39`, `src/data/casting.ts:555`, and `docs/features/casting-ready-cost-rule.md`.

## 3. Monthly sales calendar

The selected month already has an “at a glance” heading and a KPI row. Product bag counts live in the sidebar below that row. The desktop sidebar shows monthly context, while a day click opens a separate dialog.

Start with the selected month and the existing KPIs. Add **Bags sold by product** to that first row, showing Spindle and Tapper Plug totals for the selected month. Use the existing gas item aggregates and keep Spindle 7.5GM and 8.5GM available as a breakdown. Keep pieces and kg distinct from bags.

Give the calendar grid and sidebar distinct jobs. Keep day cells scannable with date, sales, and small indicators for collections, purchasing and casting. On desktop, let the right panel switch from month summary to selected-day details, with the day's totals first and linked transactions below. On mobile, keep the KPI above the grid and use the existing day dialog for detail.

Source anchors: `src/routes/monthly-sales-calendar.tsx:228`, `src/routes/monthly-sales-calendar.tsx:321`, and `src/components/calendar/calendar-month-overview.tsx:17`.

## 4. Company Report

Company Report currently adds sales and subtracts payments through the selected end date, then assigns the **entire remaining customer balance** to a single ageing bucket using the last bill date it saw. That does not show which bills were paid or which amounts are still old. It also labels 61–90 days as “Watch” in the chart while counting that band in the overdue KPI. A payment recorded after the selected end date will correctly be absent from a historical view, even if the same bill is paid today.

Reconcile the report against Party Ledger for the same customer and cutoff. Use the shared outstanding and bill allocation logic, age only the unpaid portion of each bill or opening balance, and make balances drill down to the bills and payment allocations behind them. Use the same thresholds and labels in the KPI, chart, tables and exports. Keep period sales and collections separate from balances as of the selected end date.

Before changing report visuals, verify one fully paid bill, one partly paid bill, a customer with both old and recent unpaid bills, an opening balance or advance, and a payment posted after the report cutoff. The source confirms an ageing logic mismatch. It does not establish why any particular payment was flagged without checking that record and report date.

Source anchors: `src/routes/company-report.tsx:1`, `src/routes/monthly-report.tsx:263`, `src/routes/monthly-report.tsx:974`, `src/routes/monthly-report.tsx:1368`, and `src/domain/bills.ts:32`.

## Suggested order

1. Fix bardan eligibility and complete the Purchase workflow from receipt to settlement, chitty and dashboard. Address item renames in operational views in the same phase.
2. Reconcile Company Report with Party Ledger and standardize ageing.
3. Confirm version 2 for new Casting saves and compact the chitty.
4. Rework the calendar layout and move the product bag KPI into the first row.
