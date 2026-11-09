# Kapil Billing: Four-Dashboard Rebuild Plan

Save as `docs/features/kapil-dashboards-build-plan.md`. ONE STEP PER SESSION. This is a rebuild around questions and data, not a reskin of the old screens.

## How to start each session (change only the step number)

```
Read AGENTS.md, docs/ui/CONVENTIONS.md, docs/architecture/CURRENT-STATE.md, docs/features/dashboard-data-inventory.md and docs/features/kapil-dashboards-build-plan.md completely. Implement ONLY Step N. Feature branch, no master push, no live-runtime access. Do not read archive/ or docs/archive/. Run npm run verify and npx vitest run windows/windows-package.test.ts (from the repo root), take scripts/smoke-ui.mjs screenshots at 1366px and 390px, commit, and update CURRENT-STATE.md and CONVENTIONS.md in the same commit if routes, loaders or kit components changed. Reply in max 10 lines: what changed, what to eyeball, what is blocked. Do not start the next step.
```

## 1. Goal

Four dashboards: Main (`/`, all three modules side by side), Sales (`/sales-dashboard`), Purchase (`/purchase-dashboard`), Casting (`/casting`). Each answers a few clear questions at a glance, in a consistent card layout, with better visuals than today's tables and loose boxes.

## 2. Hard rules (unchanged, repeated because they matter here)

- Modules stay isolated: no linking items or parties across modules, no netting receivables and payables, no combined net figure anywhere, no stock coupling. The Main Dashboard shows the three modules side by side, each compared only with its own previous period.
- Purchase money is integers (grams, paise, milli-rupees). Purchase dues are computed by supplier-settlement, never stored.
- Market premium vs vilaity and private notes are internal-only (fine on screen, never in exports or prints).
- Colour is state-only: rose = overdue/errors, emerald = paid/advance/NIL/positive, amber = pending/warning, slate = neutral, blue = selection only. Amounts we owe are neutral slate. Chart series do not use blue.
- No side drawers, centered dialogs only, Title Case labels, Indian number grouping.
- Never edit applied migrations; no new collections are needed for this plan.

## 3. The Cards Rule (the owner's main complaint)

**Nothing on the page background may float.** Every piece of content on every dashboard lives inside a card.
1. The only things allowed directly on the `#f1f5f9` page background are cards (`SectionCard`, `KpiCard`, `Panel`, `DashboardToolbar`) and grids/stacks whose direct children are cards.
2. No bare headings, bare text, bare tables, bare charts, bare buttons, bare empty-state text on the background. The period picker, comparison note and quick-action buttons sit inside a `DashboardToolbar` card at the top.
3. Empty, loading and error states render inside their card (skeleton, "No bills this month yet", retry), never as loose text.
4. Nested boxes inside a card use the nested style (`rounded-lg border border-slate-100 bg-slate-50 p-3`) and always carry a label inside the card.
5. Add `data-card="true"` to `SectionCard`, `KpiCard`, `Panel`, `DashboardToolbar`. Test (Step 1): render each dashboard with fixtures and assert every direct child of the page content container is a `[data-card]` element or a grid whose direct children are all `[data-card]`.
6. Step 6 audits the rest of the app against this rule (report only).

## 4. Design principles (what "better visualization" means)

1. Every widget answers ONE question, written as its card subtitle (for example "Who owes us the most?"). A widget without a clear question is dropped.
2. Two kinds of numbers, labelled on the card: **Balance now** (receivable, payable, advance, bardan pending: independent of the period) and **This period** (billed, collected, bought, paid, cast: follow the period).
3. Fair comparison: periods are This Month (default), Last Month, Last 30 Days, FY to Date (Apr 1). Compare month-to-date with the SAME NUMBER OF DAYS of the previous month (day 9 vs day 9), Last Month and FY to Date with the same-length previous period, Last 30 Days with the previous 30. If the previous value is 0 or missing show no change chip (never "Infinity", never a misleading "-350 kg").
4. Right picture for the question:
   - How much, and is it up or down? Big number + change chip + sparkline (last 6 months).
   - Trend over time? Clustered bars for two series (billed vs collected, bought vs paid out), a line for rates and costs, a bar+line combo for casting wire out and cost per kg.
   - Who or what is biggest? Ranked horizontal bars with the value at the end (never a pie).
   - How is it split? One stacked horizontal bar (ageing, Kacha vs GST). A donut is allowed only for a composition of 6 or fewer parts (casting material mix, sales payment modes), with labels and values beside it.
   - What needs action? A short list with age, amount and a button.
5. Numbers: compact on cards (₹16.2L, ₹1.8Cr), full Indian grouping in tables (₹16,16,914), exact value in a tooltip on every compact number. Weights in kg with 3 decimals only in tables; cards show whole kg or tonnes above 1,000 kg.
6. Lists never start empty: "Top items" uses the last 30 days when the month has no rows, and says so in the card subtitle.
7. Sparklines hide when there are fewer than 2 points; charts show an in-card empty state when there is no data.
8. Visual hierarchy: one hero number per module card; KPI row at the top, then trends, then ranked lists and actions, then recent activity tables.
9. Responsive: 4 KPI cards per row at 1366px, 2 at 1024px, 1 at 390px. Charts never overflow their card.
10. Charts get an `aria-label` summary, a visible legend, value labels on bars, and never rely on colour alone.

## 5. Chart kit and palette (Step 1 builds these in `src/components/charts/`)

Do not add a chart library. Keep recharts (lazy-loaded) plus small hand-built SVG/CSS parts.

| Part | Notes |
|---|---|
| `chart-theme.ts` | one file: series colours, grid, axis, tooltip, 11px text, tabular figures. Palette: primary series slate-800, second series emerald-600, benchmark/market line slate-400 dashed, warning amber-500, danger rose-500. Ageing buckets: 0-30 slate-300, 31-60 amber-400, 60+ rose-500. Donut slices use a slate ramp plus one emerald. No blue. |
| `DeltaChip` | value, direction, unit; emerald up / rose down only where up or down is clearly good or bad (billed, collected, wire out: up is good; costs, wastage: up is bad); neutral slate where it is not a judgement. Hidden when the previous value is 0 or missing. |
| `Sparkline` | tiny SVG, no library; hides under 2 points |
| `StackedBar` | horizontal proportional bar with labelled segments and values; handles all-zero |
| `RankedBars` | horizontal bars with label, value, optional sub-label and age chip, optional action button |
| `DonutSplit` | for 6 or fewer parts, centre total, labelled legend |
| `TrendChart` | recharts wrapper (bars, line, area, combo) via `React.lazy` with an in-card skeleton; max 24 points; the theme above |
| `ChartCard` | `SectionCard` plus question subtitle, legend, empty state, error state, aria summary |
| `KpiCard` (extend, stay backward compatible) | adds `delta`, `sparkline`, `hint` (period or "Balance now" label) |
| `DashboardToolbar` | a card holding the period tabs (This Month, Last Month, Last 30 Days, FY to Date), the comparison note ("vs same 9 days of October") and quick-action buttons (`buttonClass`) |
| `formatCompactInr` / `formatCompactKg` in `src/lib/inr-format.ts` | with tests |

## 6. Steps

### Step 1: Foundation (domain, chart kit, cards rule)

Skip any part that already exists (check first; do not duplicate).
1. **Domain functions (pure, tested):** one ageing helper (0-30 / 31-60 / 60+) in `src/domain/records.ts`, used by every screen that buckets ageing (remove the copies in `domain/dashboard.ts`, `routes/sales-dashboard.tsx`, `routes/monthly-report.tsx`, `data/ledger.ts`); `computeSupplierPositions` (per pool payable never below 0 and advance, plus totals, pools never cross, advance shown separately, never subtracted); period helpers `periodRange(mode, month)`, `previousPeriod(range)` with the same-days rule above and `deltaPct` returning null when the previous value is 0; `src/domain/attention-rules.ts` with named constants (customer unpaid over 45 days, supplier due over 30 days, bardan pending over 10 days, drafts waiting over 3 days, brass rate older than 3 days) and `buildAttentionItems`; casting month summary functions moved out of `routes/casting/index.tsx` into `src/domain/casting-calculations.ts` (sessions, input kg, wire out kg, wastage, chol in, coal, labour, cost per kg metal and loaded, 6-month trend, best and worst session); the per-item rate-vs-vilaity premium trend moved out of `routes/reports/purchase.tsx` into a domain function (use `supplier-market-premium.ts`); oldest bardan-pending age and count.
2. **Shared loaders:** outstanding, ageing and supplier positions need FULL history (do not date-window them). Use one cached load per module (reuse `purchaseReadModelQueryOptions` and the sales dashboard query) under the same query keys on every dashboard and report so switching pages does not refetch; use `fields` projection where lists do not need lines, photos or private notes; month-scoped figures use date-filtered queries. Keep invalidation through `src/app/query-invalidation.ts`.
3. **Chart kit** from section 5, plus the `data-card` attribute and the cards test from section 3.
4. **Docs:** add a "Cards rule" and a "Dashboard and chart kit" section to `docs/ui/CONVENTIONS.md`.
5. Existing screens switch to the new functions without layout changes. The only intended number change is Purchase "We Owe" (net payable per pool; advance shown separately). Mention it in your reply.
6. Report (do not fix) the casting trash/restore path that drops batches and inputs on restore (`routes/casting/log.tsx`, `domain/casting-trash.ts`); write the exact problem and a proposed fix into `docs/features/dashboard-data-inventory.md`.
Tests: ageing boundaries (30/31, 60/61); supplier positions (Kacha advance plus GST payable never cross-net; zero and negative outstanding); period helper (day 9 vs day 9, 31-day vs 30-day month, FY start, leap day) and `deltaPct` null on a zero previous; attention thresholds at the boundary; compact formatters; Sparkline hides under 2 points; StackedBar all-zero; the cards test on a fixture page.

### Step 2: Main Dashboard (`/`)

Rebuild from scratch from the kit. Layout top to bottom, every item in a card:
1. `DashboardToolbar`: period tabs, comparison note, quick actions (New Sale Bill, Record Payment, New Purchase Bill, New Casting Session; Purchase and Casting actions gated by modules).
2. **Needs Attention** card: one row of chips with counts, each linking to its screen: customers unpaid over 45 days, suppliers due over 30 days, bardan pending over 10 days (with the oldest age), drafts waiting, brass rate older than 3 days. All clear shows an emerald "Nothing needs attention" state inside the card.
3. **Three module cards side by side** (stacked on phone), each a `SectionCard` titled Sales / Purchase / Casting with a link to its dashboard:
   - Sales: Billed (hero, change chip, 6-month sparkline), Collected, Still to receive (Balance now).
   - Purchase: Bought (kg and amount, change chip, sparkline), Paid out, We owe (Kacha | GST shown apart; advance held shown separately).
   - Casting: Wire out kg (hero, change chip, sparkline), Loaded cost per kg, Running days. (Add Wastage % and Yield % ONLY after Step 5 validates the formulas.)
   Purchase and Casting cards disappear when their module is off and the grid reflows.
4. **Who to receive** (top 4 customers by outstanding, ranked bars, oldest unpaid age chip, "Collect" link) beside **Who to pay** (top 4 suppliers by payable, ranked bars, age chip, Pay button).
5. **Latest Sale Bills** and **Latest Purchase Bills** side by side (5 rows each, compact tables inside cards, links to the bill or chitty page).
No big charts here, only sparklines; no combined net figure. Remove the old Casting Cost Signal card, loose "Sold This Month" box and the empty-state text boxes.
Tests: module off removes its card and the grid still renders; same-days comparison note text; attention chips from fixtures.

### Step 3: Sales Dashboard (`/sales-dashboard`)

Cards (all in a grid, every item a card):
1. Toolbar with period tabs and actions (New Sale Bill, Record Payment, Export Statements).
2. KPI row: Billed, Collected, Avg Bill (period; change chips, sparklines); Bills count (period); Still to Receive (Balance now).
3. **Billed vs Collected**: clustered bars, last 6 months (series slate-800 and emerald-600).
4. **Receivable Ageing**: one `StackedBar` (0-30, 31-60, 60+) with amounts, plus the count of parties in each bucket.
5. **How Customers Pay**: `DonutSplit` of collected amount by payment mode in the period (from `payments.mode`).
6. **Top Customers by Outstanding** (ranked bars with age chip) and **Top Items** (ranked bars by kg, falls back to the last 30 days with a note) side by side.
7. **Recent Bills** and **Recent Payments** tables.
Tests: Top Items fallback to the last 30 days; payment mode split sums to the total.

### Step 4: Purchase Dashboard (`/purchase-dashboard`)

1. Toolbar with period tabs and actions (New Purchase Bill, New Purchase Payment).
2. KPI row: Bought (kg and amount, average rate, change chip), Paid Out, We Owe (Kacha and GST shown apart), Advance Held (shown separately, never subtracted), Bardan Pending (count and oldest age; amber if over 10 days).
3. **Bought vs Paid Out**: clustered bars, last 6 months.
4. **Payable Ageing**: one `StackedBar`.
5. **What We Buy**: ranked bars by kg per item for the period (items are names from `purchase_items` only).
6. **Rate vs Market**: line chart of our average rate for a chosen item against vilaity (internal-only label; item picker inside the card), showing the premium paid.
7. **Pay Next** (ranked bars with age chip and Pay button) and **Bardan Pending** list (bill, supplier, days old, amber over 10 days, "Add Bardan" action) side by side.
8. **Recent Bills** and **Recent Payments** tables.
No casting-linked columns (no "melted in furnace", no net buffer).
Tests: We Owe per pool never nets advance; bardan pending age; rate-vs-market series with exact-day and fallback-day rates.

### Step 5: Casting Dashboard (`/casting`)

**FORMULA AUDIT FIRST (blocking).** Today's screen shows Yield 237.6% and Wastage 56.2% for the same session (input 675 kg, wire out 1.60 t), which cannot both be right. Before drawing anything:
1. Read `casting-calculations.ts`, `casting_sessions` / `casting_batches` / `casting_batch_inputs` fields (`total_input_kg`, `total_mel`, `total_wire_out`, `wire_out`, `wastage`, `chol_in`, `cost_per_kg`, `total_input_cost`) and the session entry form. Reproduce the 17-10-2026 session by hand and write down what each field means.
2. Propose precise definitions of input kg, wire out kg, loss kg, wastage % and yield %. If the code does not make them unambiguous, ask the owner with `AskUserQuestion` (options plus a free answer) what goes into the furnace (scrap, chol, marobol, coal does not count as metal?) and what counts as output and loss.
3. Record the agreed definitions in `docs/architecture/DECISIONS.md` and fix the domain function, with tests. Do not show Yield % or Wastage % anywhere until this is done and the numbers are plausible (yield cannot exceed 100% unless the definition says why).
Then build:
4. Toolbar with period tabs and actions (New Casting Session, Casting Logs, Casting Bill).
5. KPI row: Wire Out (hero, kg or tonnes, change chip, sparkline), Metal Input, Loaded Cost per kg (change chip, up is bad), Wastage % (change chip, up is bad), Running Days and Batches.
6. **Wire Out and Cost**: bar plus line combo (wire out bars, loaded cost per kg line), last 6 months, with months that have no runs shown as empty (do not skip them).
7. **Cost vs Market**: loaded cost per kg against the monthly vilaity rate (benchmark line slate-400 dashed, internal label).
8. **Material Mix**: `DonutSplit` of input kg by material for the period (6 or fewer parts; the rest grouped as "Other").
9. **Best and Worst Heats**: two cards (lowest and highest loaded cost per kg) with date, wire out and a link to the log; when only one session exists show a single "Only one heat so far" card.
10. **Recent Heats** table (date, input, wire out, loss, cost per kg).
Tests: the validated formulas (the reference session, an empty month, a month with no input, yield never above 100% unless defined); 6-month trend keeps empty months; best and worst with one session.

### Step 6: Cards rule audit across the app (report only)

Write `docs/operations/cards-rule-audit.md`: for every route, list any bare heading, text, table, chart, button or empty-state text that sits directly on the page background. Table: route | violation | suggested fix | effort (S/M/L). Do not change code. Add a ratchet test with a committed baseline file so no new violations can be added (counts per route may only go down). Propose an order for fixing the rest.

## 7. Done criteria (every dashboard)

- Every item is inside a card; the cards test passes.
- Each card has a one-line question or label; Balance now vs This period is visible.
- Change chips use the same-days comparison and hide when the previous value is 0.
- Numbers use compact format on cards with exact tooltips, and Indian grouping in tables.
- Looks right at 1366px and 390px (screenshots attached to the reply).
- Disabled modules disappear cleanly; no combined net figure exists anywhere.
- First paint shows KPI cards from cached data; charts load lazily inside their cards with skeletons.
- `npm run verify` and the Windows package test pass; docs updated in the same commit.
