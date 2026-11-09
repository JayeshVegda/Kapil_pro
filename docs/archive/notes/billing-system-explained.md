# Kapil Products Billing System – Architecture & Technical Blueprint

A compact reference for designing the **Supplier Purchase (Incoming Brass)** module on top of the existing architecture.

---

## 1. PocketBase Schema

All collections defined in `pb_migrations/`. PocketBase runs SQLite with dynamic typing; tables use standard IDs (`[a-z0-9]{15}`).

| Collection | Key Fields & Types | Relations | Indexes & Constraints | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `bills` | `book_no` (num), `bill_no` (num), `date` (text YYYY-MM-DD), `accounting_time` (text), `transport` (num), `gst_rate` (num), `gst_amount` (num), `mkt` (num), `lr_no` (text), `status` (text), `bill_jpg` (file) | `customer` -> `customers` | `UNIQUE(book_no, bill_no)`, `INDEX(customer)`, `INDEX(date)` | Outgoing sales invoice header |
| `bill_items` | `item_name` (text), `qty` (num), `rate` (num), `amount` (num), `bags` (num) | `bill` -> `bills` (cascade delete), `item` -> `items` | `INDEX(bill)`, `INDEX(item)` | Line items for sales bills |
| `payments` | `date` (text), `amount` (num), `mode` (text: cash/bank/cheque), `note` (text) | `customer` -> `customers` | `INDEX(customer)`, `INDEX(date)` | Customer payments received (unlinked) |
| `customers` | `name` (text), `company_name` (text), `cust_type` (text: regular/sp7/sp8), `opening_balance` (num), `opening_balance_date` (text), `aliases` (text), `active` (bool) | None | `UNIQUE(name)`, `INDEX(active)` | Customer party master |
| `items` | `name` (text), `default_rate` (num), `group` (text: gas/general), `unit` (text: kg/pcs), `active` (bool) | None | `UNIQUE(name)`, `INDEX(active)` | Finished goods product master |
| `brass_rates` | `date` (date/text), `vilaity` (num, Jamnagar scrap rate), `honey_gulf` (num), `honey_europe` (num), `plant_pass` (num), `zinc_9995` (num), MCX/LME trends | None | `UNIQUE(date)` | Daily scrap benchmark market rates |
| `bill_drafts` | `customer_name` (text), `date` (text), `book_no` (num), `bill_no` (num), `mkt` (num), `transport` (num), `gst_rate` (num), `status` (text: staged/pending_review/approved/rejected), `source` (text: muse_ai) | `customer` -> `customers`, `converted_bill` -> `bills` | `INDEX(status)`, `INDEX(customer)` | Staging header for AI agent drafts |
| `bill_draft_items` | `item_name` (text), `qty` (num), `rate` (num), `amount` (num), `bags` (num) | `draft` -> `bill_drafts` (cascade delete), `item` -> `items` | `INDEX(draft)` | Staged line items for AI drafts |
| `bill_draft_payments` | `amount` (num), `mode` (text), `date` (text), `note` (text) | `draft` -> `bill_drafts` (cascade delete) | `INDEX(draft)` | Staged payments with AI drafts |
| `payment_drafts` | `customer_name` (text), `amount` (num), `mode` (text), `date` (text), `status` (text) | `customer` -> `customers`, `converted_payment` -> `payments` | `INDEX(status)` | Staged standalone payment entries |
| `casting_sessions` | `date` (text), `unit` (text), `wire_out_kg` (num), `wastage_kg` (num), `chol_recovered_kg` (num), `cost_per_kg` (num) | None | `INDEX(date)` | Factory melting/casting session header |
| `casting_inputs` | `material_name` (text), `kg` (num), `rate` (num), `amount` (num) | `session` -> `casting_sessions` | `INDEX(session)` | Raw material consumption in casting |
| `stock_in` | `date` (text), `item_name` (text), `qty` (num), `note` (text) | `item` -> `items`, `customer` -> `customers` | `INDEX(item)` | Finished goods warehouse additions |

*Note on Scrap Buying Collections:* Created in `pb_migrations/1783414524_*` (`suppliers`, `purchase_bills`, `purchase_items`, `purchase_deductions`, `supplier_payments`, `supplier_payment_allocations`) and immediately dropped in `pb_migrations/1783500001_drop_scrap_buying_collections.js`. They do not exist in live runtime.

---

## 2. Money & Weight Representations

- **Database Storage:** PB fields use `"type": "number"` with `"onlyInt": false`. All amounts and weights are stored as standard **floating-point numbers**.
- **Units:**
  - Weight: Stored in **Kilograms (kg)** (e.g., `569.4` kg). Finished goods use pieces/bags where applicable.
  - Money: Stored in **INR Rupees (₹)** (e.g., `12450.50`), NOT integer paise.
- **Rounding Rules:** Centralized in [`src/domain/financial-math.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/financial-math.ts):
  - `roundPaise(v) = Math.round((Number(v) + Number.EPSILON) * 100) / 100` (2 decimal places).
  - Line amount calculation: `roundPaise(qty * rate)` ([`src/domain/billing-calculations.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/billing-calculations.ts#L17)).
  - Bill totals: `roundPaise(itemsTotal + transport + gstAmount)`.
  - UI Display: [`src/lib/inr-format.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/lib/inr-format.ts) uses `formatInrInteger` (rounded to nearest integer ₹ for bills/ledgers) or `formatInr` (2 decimals).

---

## 3. Core Business Logic & Algorithms

- **Customer Outstanding (`computeCustomerOutstanding()` in [`src/domain/records.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/records.ts#L55)):
  - Formula: $\text{Net Balance} = \text{Opening Balance} + \sum \text{Billed Total} - \sum \text{Paid Total}$.
  - Computed on-the-fly dynamically across all records $\le \text{asOfDate}$. Not stored as a materialized total on customer row.
- **FIFO Payment Matching (`computeBillStatuses()` in [`src/domain/bills.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/bills.ts#L32)):
  - Payments are **unallocated** in the database (no payment-to-bill junction table).
  - Memory-based FIFO: Sort bills and payments ASC by `businessDate -> createdAt -> id`.
  - Step 1: Payments first extinguish positive `openingBalance`.
  - Step 2: Remaining payments extinguish bills in chronological order.
  - Bill Statuses: `pending` (0 paid), `partial` ($0 < \text{paid} < \text{total} - 0.005$), `paid` ($\text{paid} \ge \text{total} - 0.005$). The $0.005$ tolerance prevents half-paise floating point mismatch.
- **Physical Bill-Book Rules ([`src/domain/bill-books.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/bill-books.ts)):
  - `BILL_BOOK_SIZE = 50`. Books start at 1, 51, 101... First bill number equals book number.
  - Gaps/skipped numbers are deliberately **never re-offered** (indicates torn/spoiled physical sheet).
- **Market Rate Lookup ([`src/domain/market-rate.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/market-rate.ts)):
  - Reads `vilaity` field from `brass_rates`.
  - Fallback logic (`loadSavedMarketRateForDate`): Queries exact day (`date >= start && date < end`). If missing or $\le 0$, queries nearest prior day (`date < start`, `sort: -date`).

---

## 4. Scrap Buying Module (Current vs Required)

- **Existing State:** Completely decommissioned. Zero routes exist in `src/routes/`. Dropped migration `1783500001_drop_scrap_buying_collections.js` eliminated the tables. Only architectural specification exists in [`docs/features/procurement-casting-sales-workflow.md`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/docs/features/procurement-casting-sales-workflow.md).
- **Differences from Sales Billing:**
  - Direction: Supplier is creditor (payable increases with purchase, decreases with payment/returns).
  - Calculations: Has dual bag deduction styles (deduct weight before amount vs deduct bag value after gross amount).
  - Deductions: Non-item deductions (faulty material return, rate cut, bardan credit).
- **Missing Elements for Supplier Ledger:**
  - No `suppliers`, `purchase_bills`, `purchase_items`, `supplier_payments` tables.
  - No persistent payment allocation (FIFO or manual override).
  - No bardan (gunny bag) tracking or settlement modes.

---

## 5. Ledger & Print / Export Flows

- **Customer Ledger (`src/routes/ledger.tsx`, `src/domain/ledger.ts`):**
  - Renders running balance ledger combining opening balance, bills, and payments in ascending chronological order.
  - Displays summary KPIs (net due, total billed, total paid, average bill size) and item-wise sales volume.
- **Bill Print & Share Engine ([`src/lib/bill-print-export.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/lib/bill-print-export.ts)):**
  - Layout: [`src/components/billing/bill-print-layout.tsx`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/components/billing/bill-print-layout.tsx) formatted for $14.5\text{ cm}$ stationary width.
  - Browser Print: Opens isolated window or hidden iframe via [`src/lib/print-html.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/lib/print-html.ts).
  - JPG Export: DOM-to-canvas rendering via `html-to-image` / `html2canvas` (0.97 quality download, 0.93 quality share).
  - WhatsApp: Native Web Share API with JPG blob fallback to pre-filled `https://wa.me/?text=...` URI.

---

## 6. Patterns to Reuse

- **React Query (`@tanstack/react-query`):**
  - Strict tuple keys: `['customers']`, `['bills', customerId]`, `['payments']`, `['drafts']`.
  - Centralized invalidation helper: [`src/data/query-invalidation.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/data/query-invalidation.ts).
- **Keyboard-First Data Entry ([`src/routes/new-bill.tsx`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/routes/new-bill.tsx)):**
  - Arrow key / Enter grid navigation, `Ctrl+Enter` save, ref traversal without mouse.
  - Customer selection via searchable combobox with quick-search aliases.
- **Command Palette (`Ctrl+K`):** [`src/components/layout/app-shell.tsx`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/components/layout/app-shell.tsx) & [`src/lib/commands.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/lib/commands.ts).
- **Data Health Probes:** [`src/data/health.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/data/health.ts) & [`src/domain/health-checks.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/health-checks.ts) verify collections, latency, and rate freshness.
- **Testing Pattern:** Vitest unit tests in `src/domain/*.test.ts`. Pure mathematical functions decoupled from database mocks (e.g., [`src/domain/billing-calculations.test.ts`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/src/domain/billing-calculations.test.ts)).

---

## 7. Safety, Auditing & Staging

- **Audit Logging:** **No dedicated audit collection**. Changes are written directly. Daemon events log to `runtime/logs/operations.log`.
- **Soft Delete:** **None**. Bills and payments perform hard `DELETE`. Only `customers` and `items` have an `active: bool` flag.
- **Edit After Payment:** Permitted. Because bill status is resolved dynamically in-memory, updating a bill or payment immediately recomputes downstream statuses upon next query.
- **AI Staging Inbox (Muse):**
  - Dedicated relational draft tables: `bill_drafts`, `bill_draft_items`, `bill_draft_payments`.
  - Muse AI writes only to staging with role `muse`. Operator inspects on `/drafts`, loads into `/new-bill`, reviews diffs, and commits to production tables.

---

## 8. Architectural Gotchas & Constraints

1. **Floating Point Rounding:** Since SQLite and JS use floats, failure to wrap calculations in `roundPaise()` produces binary float anomalies (e.g. `1200.0000000000002`).
2. **In-Memory FIFO Volatility:** Altering or back-dating an old payment ripples through all subsequent bill statuses for that party.
3. **Draft Bill Auto-Numbering:** If an agent draft omits `book_no` / `bill_no`, editor must fall back to `getCustomerBookSelection()` and `getNextBillNoForBook()`.
4. **Environment Constraints:** Host environment lacks 64-bit PowerShell path (`powershell.exe` in `SysWOW64`), background tasks must run via `wscript.exe` ([`windows/watchdog-silent.vbs`](file:///C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/windows/watchdog-silent.vbs)).

---

## Component Categorization for Supplier Module Extension

### Reusable as-is
- `src/domain/financial-math.ts` – `roundPaise()`, `safeNumber()`, `splitBalance()`, date comparison.
- `src/domain/market-rate.ts` – Market rate lookup and fallback logic.
- `src/data/pocketbase.ts` – PocketBase client instance and auth state.
- `src/data/query-invalidation.ts` – Cache invalidation dispatcher.
- `src/lib/inr-format.ts` – Currency formatting helpers.
- `src/lib/print-html.ts` & `src/lib/image-export.ts` – Print popup and JPG generation engine.
- `src/components/ui/*` – Buttons, Dialogs, Combobox, Table primitives.

### Needs Refactor / Adaptation for Suppliers
- `src/domain/records.ts` – Needs supplier counterpart (`computeSupplierOutstanding`) where purchases add and payments subtract.
- `src/domain/bills.ts` – Needs adapted settlement logic supporting both FIFO and explicit payment allocations.
- `src/routes/ledger.tsx` – Replicate pattern to build `/supplier-ledger` with bill-mode filters (`kacha` / `gst`).
- `src/routes/drafts.tsx` – Generalize or create `/supplier-drafts` for Muse scrap buying staging.

### Must Not Touch (Core Sales Stability)
- `src/domain/bill-books.ts` – Customer sales bill pad logic (50 bills/book).
- `src/routes/new-bill.tsx` & `src/routes/print-bill.tsx` – Customer sales creation and printing.
- `src/routes/new-payment.tsx` – Customer receipt creation.
- `pb_migrations/1783414524_*` – Do not modify historical migration files; create new migration timestamp files.
