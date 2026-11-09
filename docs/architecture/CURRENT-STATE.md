# Kapil Billing — Current System State

> **Date:** 2026-11-09  
> **Source:** Generated directly from active codebase inspection  
> **Host Model:** Arch Linux / CachyOS (Development) · Windows PC (Production Local-Primary)

---

## 1. Routes & Sidebar Navigation

### Navigation Rail Layout
- **Top Level:**
  - `/`: Main Business Dashboard (month selector, KPI cards, Sales vs Collections Recharts curve, recent bills).
  - `/drafts`: AI Drafts inbox (review and approve `bill_drafts` and `payment_drafts`).
  - `/ledger`: Unified Party Ledger (2 tabs: Customers and Suppliers, dual Kacha/GST running balance).
- **Sales Module:**
  - `/sales-dashboard`: Sales analytics sub-dashboard (receivable ageing, top items, collections).
  - `/new-bill`: Fast keyboard-first Sales Bill generation (`Alt+B` rapid entry, items autocomplete).
  - `/new-payment`: Customer payment settlement entry with automatic outstanding adjustment.
  - `/transactions`: Sales transaction logbook (combined bills and receipts).
  - `/print-bill`: Printable tax invoice view with CSS print layout rules.
- **Purchase Module:**
  - `/purchase-dashboard`: Procurement sub-dashboard (today's metal intake strip, spend trend, material matrix).
  - `/new-purchase-bill`: Scrap intake bill entry (gross/tare weight, Jamnagar market benchmark delta, bag count, Chitty preview).
  - `/new-supplier-payment`: Supplier payment entry with Kacha/GST pool selection.
  - `/purchase-bills`: Multi-tab purchase operations hub (Bills list, Payments list, Bardan tracking).
  - `/purchase-logs`: Complete immutable audit log of procurement transactions.
- **Casting Module:**
  - `/casting`: Foundry runs dashboard and crucible performance metrics.
  - `/casting/new-session`: Melting session entry (ingot/scrap inputs vs wire outputs, yield calculation).
  - `/casting/log`: Historical foundry logbook.
  - `/casting/bill`: Job-work casting invoice generator for third-party clients.
- **Reports:**
  - `/monthly-sales-calendar`: Daily sales activity calendar with heatmap.
  - `/monthly-report`: High-level company executive report and YTD metrics.
  - `/reports/sales`: Dedicated Sales analytics report.
  - `/reports/purchase`: Dedicated Purchase analytics report.
  - `/reports/casting`: Dedicated Foundry efficiency report.
  - `/export-reports`: Export studio (PDF, Excel XLSX, ZIP ledger packages).
- **Setup & Utilities:**
  - `/items`: Unified Items Management (3 tabs: Sale Items, Purchase Items, Casting Items).
  - `/issues`: System alert log.
  - `/data-health`: Database integrity audit tool.
  - `/backup`: PocketBase backup trigger and restore interface.
  - `/settings`: Module toggles (`app_settings`), firm identity, and print preferences.
  - `/dev/components`: Internal UI component gallery.

### Active Legacy Redirects
Old bookmarks and links are redirected to their consolidated hubs:
- `/customers` $\to$ `/ledger?tab=customers`
- `/suppliers` $\to$ `/ledger?tab=suppliers`
- `/purchase-items` $\to$ `/items?tab=purchase`
- `/casting/materials` $\to$ `/items?tab=casting`
- `/bardan-pending` $\to$ `/purchase-bills?tab=bardan`
- `/supplier-payments` $\to$ `/purchase-bills?view=payments`
- `/calendar` $\to$ `/monthly-sales-calendar`

---

## 2. PocketBase Database Schema & Collections

| Module | Collection | Key Fields | Purpose |
| :--- | :--- | :--- | :--- |
| **Sales** | `bills` | `bill_number`, `customer`, `business_date`, `subtotal`, `grand_total`, `status` | Outbound tax invoices |
| | `bill_items` | `bill`, `item`, `item_name`, `quantity`, `rate`, `amount` | Invoice line items |
| | `customers` | `name`, `company_name`, `opening_balance`, `active`, `phone`, `gstin` | Sales clients (never hard-deleted) |
| | `payments` | `customer`, `business_date`, `amount`, `payment_mode`, `note` | Sales receipts |
| | `bill_drafts` | `suggested_data`, `status`, `preview_jpg` | Incoming drafts from Muse/scans |
| | `payment_drafts`| `customer_name`, `amount`, `payment_mode`, `status` | Incoming payment drafts |
| | `items` | `name`, `default_rate`, `category`, `active` | Finished brass goods catalog |
| | `brass_rates` | `date`, `item_name`, `rate`, `raw_text` | Daily market rate scrapings |
| **Purchase** | `suppliers` | `name`, `opening_kacha_paise`, `opening_gst_paise`, `active`, `phone` | Scrap suppliers (never hard-deleted) |
| | `purchase_bills` | `supplier`, `bill_date`, `total_amount_paise`, `kacha_due_paise`, `gst_due_paise` | Inbound scrap bills |
| | `purchase_bill_lines` | `bill`, `purchase_item`, `item_name`, `weight_g`, `rate_milli`, `amount_paise` | Scrap line items (integer units) |
| | `purchase_bill_adjustments` | `bill`, `amount_paise`, `reason` | Price or weight adjustments |
| | `purchase_bardan` | `bill`, `supplier`, `bardan_bags`, `settled_bags`, `status` | Bag balance tracking |
| | `purchase_items` | `name`, `active` | Scrap intake grades (e.g. Honey, Pata) |
| | `supplier_payments` | `supplier`, `amount_paise`, `pool` (`kacha`\|`gst`), `mode` | Payments to suppliers |
| | `supplier_payment_allocations` | `payment`, `bill`, `amount_paise` | FIFO payment settlements |
| | `purchase_audit_log` | `actor`, `action`, `entity_type`, `entity_id`, `details` | Immutable purchase audit record |
| **Casting** | `casting_sessions` | `session_date`, `total_input_kg`, `total_output_kg`, `yield_pct` | Melting furnace runs |
| | `casting_inputs` | `session`, `material_name`, `weight_kg` | Furnace charge composition |
| | `casting_materials`| `name`, `category`, `active` | Ingot and flux material catalog |
| **Settings** | `app_settings` | `purchase_enabled` (bool), `casting_enabled` (bool) | Shared multi-device module toggles |

---

## 3. Data Flows (5-Line Summary per Module)

### Sales Data Flow
1. Operator creates bill in `new-bill.tsx` selecting customer and items with real-time tax calculation.
2. `src/domain/bill-books.ts` allocates sequence number; data written via `src/data/bills.ts` in single transaction.
3. Customer payment arrives in `new-payment.tsx`; `src/data/payments.ts` saves receipt and updates customer dues.
4. `src/domain/dashboard.ts` aggregates receivables, monthly sales, and collection curves for `/index.tsx`.
5. Statements and formal tax invoices export as PDF/Excel via `src/lib/exports/`.

### Purchase Data Flow
1. Raw scrap truck arrives; operator inputs weight (g), rate/kg (milli-rupees), and bag count in `new-purchase-bill.tsx`.
2. Line items compute in integer paise via `src/domain/supplier-units.ts`; bill saves with dual Kacha/GST pool split.
3. Supplier payment in `new-supplier-payment.tsx` allocates via FIFO settlement in `src/domain/supplier-settlement.ts`.
4. Bardan bags track in `purchase_bardan`; outstanding dues compute in `src/domain/supplier-ledger.ts`.
5. Thermal physical Chitty prints instantly via `src/components/suppliers/bill-chitty.tsx`.

### Casting Data Flow
1. Foundry foreman logs furnace charge (ingot/scrap weights) in `casting/new-session.tsx`.
2. Molten metal poured into wire coils; finished output weight recorded in `casting_sessions`.
3. `src/domain/casting-calculations.ts` computes burning loss, net yield percentage, and cost per kg.
4. Finished wire stock feeds sales inventory; casting bills for job-work clients generated in `casting/bill.tsx`.
5. Historical yields, monthly melting volume, and efficiency trends report on `/casting` and `/reports/casting`.

---

## 4. Module Settings Architecture

```
[/settings Page]
       │
       ▼ (saves via src/data/module-settings.ts)
[PocketBase: app_settings] (record: 'globalsettings1')
       │
       ▼ (5-min cache: loadModuleSettingsForGuard)
┌─────────────────────────────────────────────────────────────┐
│                      Enforcement Points                     │
├─────────────────────────────────────────────────────────────┤
│ 1. Route Guards: redirect disabled routes to '/'            │
│ 2. SidebarNav: filters navigation groups dynamically        │
│ 3. QuickSearch (Ctrl+K): omits disabled module commands     │
│ 4. Unified Hubs: hide Purchase / Casting tabs in /items,    │
│    /ledger, and report selectors                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Test & Tooling Map

- **Typecheck:** `tsc -b` (configured in `tsconfig.app.json`, `tsconfig.node.json`).
- **Unit & Domain Tests:** Vitest (`npm test`), 64 test suites running 457 tests (excluding `archive/**`, `dist/**`, `node_modules/**`).
- **Production Build:** Vite with Rolldown output chunking (`vendor-react`, `vendor-data`), producing static assets in `dist/`.
- **Harness Verification:** `npm run verify` executes typecheck, tests, and build sequentially.
- **Windows Production Safety:** `npx vitest run windows/windows-package.test.ts` validates loopback binding and secret isolation.
