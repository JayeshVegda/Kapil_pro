# Kapil Billing — Current System State

> **Date:** 2026-11-09  
> **Source:** Verified directly from active codebase inspection (`pb_migrations`, `src/data/`, `src/domain/`, `src/routes/`)  
> **Host Model:** Arch Linux / CachyOS (Development) · Windows PC (Production Local-Primary)

---

## 1. Routes & Sidebar Navigation

### Navigation Rail Layout
- **Top Level:**
  - `/`: Main Business Dashboard (DashboardToolbar period tabs, Needs Attention operational exception strip, Sales/Purchase/Casting pulse cards side by side, Who to Receive/Pay ranked bars, latest bills).
  - `/drafts`: AI Drafts inbox (review and approve `bill_drafts` and `payment_drafts` staged by Muse).
  - `/ledger`: Unified Party Ledger (two tabs: `Customers` with sales statements and PDF/XLSX export, and `Suppliers` with dual Kacha/GST running balance and JPG export).
- **Sales Module:**
  - `/sales-dashboard`: Sales analytics sub-dashboard (receivable ageing, top items, collections).
  - `/new-bill`: Fast keyboard-first Sales Bill generation with item autocomplete.
  - `/new-payment`: Customer collection recording with auto-balance recalculation.
  - `/transactions`: Sales transaction logbook (combined bills and receipts) with local trash restore.
  - `/print-bill`: Printable tax invoice view with CSS print layout.
- **Purchase Module:**
  - `/purchase-dashboard`: Procurement sub-dashboard (metal intake summary, spend trend, material breakdown).
  - `/new-purchase-bill`: Scrap intake bill entry with line-rate entry, market delta, and live chitty slip.
  - `/new-supplier-payment`: Supplier payment entry with pool selection (`kacha` or `gst`) and auto-settlement.
  - `/purchase-bills`: Multi-tab purchase hub (Bills list, Payments list, Bardan tracking).
  - `/purchase-bills/$billId`: Dedicated printable thermal-style chitty page for a single purchase bill with line breakdown, bardan status, and navigation.
  - `/print-purchase-bills`: Multi-bill printable chitty runner and viewer.
  - `/purchase-logs`: Unified 90-day paginated log of purchase bills, payments, and audit events.
- **Casting Module:**
  - `/casting` (or `/casting/index`): Foundry dashboard with yields, furnace runs, wire output, and cost per kg.
  - `/casting/new-session`: Record heats, batch metal inputs, output wire kg, and loss %.
  - `/casting/log`: Historical foundry logbook with local trash/restore.
  - `/casting/bill`: Job-work casting invoice generator for third-party clients.
- **Reports:**
  - `/monthly-sales-calendar`: Daily calendar with day sales, purchase totals, and casting runs.
  - `/monthly-report`: High-level company executive report and YTD metrics.
  - `/reports/sales`: Dedicated Sales analytics report.
  - `/reports/purchase`: Dedicated Purchase analytics report.
  - `/reports/casting`: Dedicated Foundry efficiency report.
  - `/export-reports`: Export studio (PDF, Excel XLSX, ZIP ledger packages).
- **Setup & Utilities:**
  - `/items`: Unified Items Management (three isolated tabs: `Sale Items`, `Purchase Items`, `Casting Items`).
  - `/issues`: System alert and mismatch log.
  - `/data-health`: Database integrity audit tool and book sequence checker.
  - `/control-room`: Admin operations, lock/unlock toggle, and data health shortcuts.
  - `/backup`: PocketBase backup trigger and restore interface.
  - `/settings`: Module toggles (`app_settings`), firm identity, and print preferences.
  - `/dev/components`: Internal UI component gallery.

### Active Legacy Redirects
- `/customers` $\to$ `/ledger?tab=customers`
- `/suppliers` $\to$ `/ledger?tab=suppliers`
- `/purchase-items` $\to$ `/items?tab=purchase`
- `/casting/materials` $\to$ `/items?tab=casting`
- `/bardan-pending` $\to$ `/purchase-bills?tab=bardan`
- `/supplier-payments` $\to$ `/new-supplier-payment`
- `/calendar` $\to$ `/monthly-sales-calendar`
- `/supplier-ledger/$supplierId` $\to$ `/ledger?tab=suppliers&supplierId=...` (redirects via `beforeLoad`; hosts the embedded `SupplierLedgerDetail` component)

---

## 2. PocketBase Database Schema & Collections

| Module | Collection | Purpose | Key Fields (Verified) |
| :--- | :--- | :--- | :--- |
| **Sales** | `bills` | Outbound tax invoices | `id`, `book_no`, `bill_no`, `bill_ref`, `date`, `customer`, `customer_name`, `mkt`, `transport`, `gst_rate`, `gst_amount`, `lr_no`, `status`, `bill_jpg`, `created`, `updated` |
| | `bill_items` | Sales invoice line items | `id`, `bill`, `item`, `item_name`, `qty`, `rate`, `amount`, `bags`, `created`, `updated` |
| | `customers` | Sales buyers master (never hard-deleted) | `id`, `company_name`, `name`, `phone`, `gstin`, `address`, `credit_limit`, `opening_balance`, `opening_balance_date`, `note`, `cust_type`, `active`, `created`, `updated` |
| | `payments` | Customer collections / receipts | `id`, `customer`, `customer_name`, `date`, `amount`, `mode`, `note`, `created`, `updated` |
| | `brass_rates` | Historical brass market rates | `id`, `date`, `vilaity`, `honey_gulf`, `honey_europe`, `source`, `note`, `raw_text`, `jamnagar_trend`, `vilaity_trend`, `created`, `updated` |
| | `items` | Finished brass goods catalog | `id`, `name`, `default_rate`, `type`, `unit`, `bag_weight`, `group`, `active`, `created`, `updated` |
| | `bill_drafts` | Muse WhatsApp/scan bill drafts | `id`, `customer`, `customer_name`, `book_no`, `bill_no`, `date`, `mkt`, `transport`, `gst_mode`, `gst_rate`, `gst_amount`, `lr_no`, `confidence`, `notes`, `raw_text`, `status`, `converted_bill`, `created`, `updated` *(Note: `preview_jpg` was removed by migration `1792916000`)* |
| | `bill_draft_items` | Draft bill line items | `id`, `draft`, `item`, `item_name`, `qty`, `rate`, `amount`, `bags`, `created`, `updated` |
| | `bill_draft_payments` | Draft bill payment rows | `id`, `draft`, `amount`, `mode`, `date`, `note`, `created`, `updated` |
| | `payment_drafts` | Muse WhatsApp/SMS payment drafts | `id`, `customer`, `customer_name`, `date`, `amount`, `mode`, `note`, `confidence`, `raw_text`, `status`, `converted_payment`, `created`, `updated` |
| **Purchase** | `suppliers` | Scrap vendors master (never hard-deleted) | `id`, `company_name`, `contact_name`, `phone`, `gst_no`, `city`, `notes`, `opening_kacha_paise`, `opening_gst_paise`, `opening_balance_date`, `active`, `created`, `updated` |
| | `purchase_bills` | Inward scrap bills | `id`, `supplier`, `in_no`, `supplier_bill_no`, `date`, `pool` (`kacha`\|`gst`), `tax_mode` (`none`\|`gst`\|`rcm`), `gst_rate_bp`, `group_id`, `vehicle_no`, `private_note`, `photos`, `cancelled`, `cancel_reason`, `created`, `updated` *(Note: dues, paid amounts, and totals are computed by `supplier-settlement`; they are not stored columns)* |
| | `purchase_bill_lines` | Scrap inward line items (integer units) | `id`, `bill`, `item`, `item_name`, `weight_g`, `rate_milli`, `amount_paise`, `created`, `updated` |
| | `purchase_bill_adjustments` | Bill deductions & charges | `id`, `bill`, `type` (`labour`\|`transport`\|`quality_cut`\|`other`), `amount_paise`, `note`, `created`, `updated` |
| | `purchase_bardan` | Empty bag settlements per bill | `id`, `bill`, `bardan_g`, `rate_line`, `rate_milli`, `method` (`deduct`\|`in_kind`\|`cash_back`\|`advance`), `credit_paise`, `cash_amount_paise`, `date`, `note`, `created`, `updated` |
| | `purchase_items` | Raw scrap brass items master | `id`, `name`, `active`, `created`, `updated` |
| | `supplier_payments` | Outgoing payments & credit events | `id`, `supplier`, `date`, `pool` (`kacha`\|`gst`), `kind` (`payment`\|`paid_on_behalf`\|`settle_off`\|`refund_received`\|`bardan_advance`), `amount_paise`, `mode`, `reference`, `payee_name`, `private_note`, `photos`, `cancelled`, `cancel_reason`, `created`, `updated` |
| | `supplier_payment_allocations` | Manual payment-to-bill allocation pins | `id`, `payment`, `bill`, `amount_paise`, `created`, `updated` |
| | `purchase_audit_log` | Immutable purchase audit record | `id`, `collection`, `record_id`, `action`, `before_json`, `after_json`, `actor`, `created` |
| **Casting** | `casting_sessions` | Foundry melting runs | `id`, `date`, `unit`, `coal_kg`, `coal_rate`, `worker_salary`, `wire_out`, `wastage`, `chol_in`, `total_wire_out`, `total_mel`, `cost_per_kg`, `total_input_cost`, `total_input_kg`, `note`, `created`, `updated` |
| | `casting_batches` | Furnace batches in a session | `id`, `session`, `batch_number`, `wire_out`, `mel`, `created`, `updated` |
| | `casting_batch_inputs` | Raw scrap charges per batch | `id`, `batch`, `material`, `material_name`, `qty`, `rate`, `amount`, `created`, `updated` |
| | `casting_materials` | Foundry materials catalog | `id`, `name`, `code`, `category`, `is_active`, `created`, `updated` |
| **Settings** | `app_settings` | Multi-device module switches | `id` (`globalsettings1`), `key` (`global_settings`), `purchase_enabled` (bool), `casting_enabled` (bool), `created`, `updated` |

---

## 3. Data Flows (Summary per Module)

### Sales Data Flow
1. Operator creates a bill in `/new-bill` selecting customer, items, and tax parameters with real-time totals.
2. Numbering is allocated via `src/domain/bill-books.ts` (physical books of 50 bills); bill and line records persist via `src/data/bills.ts`.
3. Customer payment is recorded in `/new-payment`; persists via `src/data/payments.ts` and recalculates bill statuses.
4. Outstanding balances and statuses compute purely via `computeCustomerOutstanding()` in `src/domain/records.ts` and `computeBillStatuses()` in `src/domain/bills.ts`.
5. Statements and tax invoices export as PDF, Excel XLSX, or JPG via `src/lib/`.

### Purchase Data Flow
1. Operator records inward scrap in `/new-purchase-bill` specifying supplier, pool (`kacha` or `gst`), tax mode, and items in integer grams and milli-rupees.
2. Line amount in paise computes as `roundHalfUp(weight_g * rate_milli / 10000)`; IN number is allocated from FY sequence (never reused).
3. Empty bags are recorded in `purchase_bardan` per entry with settlement method (`deduct`, `in_kind`, `cash_back`, or `advance`).
4. Outgoing payments or credit events are logged in `/new-supplier-payment` in integer paise for a specific pool.
5. Outstanding dues, FIFO matching, and bardan status compute on read via `src/domain/supplier-settlement.ts` and display in `/purchase-bills/$billId` (printable chitty) and `/ledger`.

### Casting Data Flow
1. Operator records melting runs in `/casting/new-session`, logging furnace batches, scrap material inputs, and fuel/labour expenses.
2. Material inputs, output wire weight, and mel/wastage are recorded per batch across `casting_batches` and `casting_batch_inputs`.
3. Session totals, burning loss, and net cost per kg are calculated via `src/domain/casting-calculations.ts` and stored in `casting_sessions`.
4. Casting job-work bills can be generated in `/casting/bill`.
5. Historical yields, monthly volume, and cost trends display on `/casting` and `/reports/casting`.

---

## 4. Module Settings Architecture

```
[/settings Page]
       │
       ▼ (saves via src/data/module-settings.ts)
[PocketBase: app_settings] (record: 'globalsettings1')
       │
       ▼ (cached: loadModuleSettingsForGuard)
┌─────────────────────────────────────────────────────────────┐
│                      Enforcement Points                     │
│ 1. Route Guards: __root.tsx isPathHiddenByModules redirects  │
│ 2. SidebarNav: filters navigation groups dynamically        │
│ 3. QuickSearch (Ctrl+K): omits disabled module commands     │
│ 4. Unified Hubs: hides Purchase / Casting tabs in /items,   │
│    /ledger, and report selectors                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Test & Tooling Map

- **Typecheck:** `tsc -b` (configured in `tsconfig.app.json`, `tsconfig.node.json`).
- **Unit & Domain Tests:** Vitest (`npm test`), testing domain math, data transformations, and components.
- **Production Build:** Vite output chunking, producing static assets in `dist/`.
- **Harness Verification:** `npm run verify` executes typecheck, tests, and build sequentially.
- **Windows Production Safety:** `npx vitest run windows/windows-package.test.ts` validates loopback binding and secret isolation.
