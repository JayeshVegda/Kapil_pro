# System Architecture Map — Kapil Billing

## 1. Routes & Navigation Today
| Path | Route File | Sidebar Label | Group | Status / Redirect |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `src/routes/index.tsx` | Dashboard | Top | Active |
| `/drafts` | `src/routes/drafts.tsx` | AI Drafts | Top | Active |
| `/ledger` | `src/routes/ledger.tsx` | Party Ledger | Top | Active (Customer ledger today) |
| `/new-bill` / `/new-payment` | `src/routes/{new-bill,new-payment}.tsx` | Sale Bills / Payment | Sales | Active |
| `/transactions` / `/print-bill` | `src/routes/{transactions,print-bill}.tsx` | Sales Logs / Print Bills | Sales | Active |
| `/purchase-dashboard` | `src/routes/purchase-dashboard.tsx` | Purchase Dashboard | Purchase | Active |
| `/new-purchase-bill` / `payment` | `src/routes/{new-purchase-bill,new-supplier-payment}.tsx`| New Purchase Bill / Pay | Purchase | Active |
| `/purchase-bills` / `/$billId` | `src/routes/purchase-bills/{index,$billId}.tsx` | Purchase Bills | Purchase | Active (Hub + Chitty detail) |
| `/purchase-logs` / `/suppliers` | `src/routes/{purchase-logs,suppliers}.tsx` | Purchase Logs / Suppliers | Purchase | Active |
| `/supplier-ledger/$supplierId` | `src/routes/supplier-ledger.$supplierId.tsx` | — | — | Active |
| `/supplier-payments` | `src/routes/supplier-payments.tsx` | Supplier Payments | Purchase | **Redirects** to `/new-supplier-payment` |
| `/bardan-pending` | `src/routes/bardan-pending.tsx` | — | — | **Redirects** to `/purchase-bills?tab=bardan` |
| `/casting` / `/new-session` | `src/routes/casting/{index,new-session}.tsx` | Casting Dashboard / New | Casting | Active |
| `/casting/log` / `/bill` / `/materials` | `src/routes/casting/{log,bill,materials}.tsx` | Logs / Bill / Materials | Casting | Active (`materials` is usage report) |
| `/customers` | `src/routes/customers.tsx` | Customers | Customers | Active (Master page alive) |
| `/monthly-sales-calendar` | `src/routes/monthly-sales-calendar.tsx` | Calendar | Reports | Active (`/calendar` redirects here) |
| `/monthly-report` / `/export-reports`| `src/routes/{monthly-report,export-reports}.tsx` | Company Report / Exports | Reports | Active |
| `/items` | `src/routes/items.tsx` | Items | Setup | Active (Dual-tab: Selling & Purchase) |
| `/purchase-items` | `src/routes/purchase-items.tsx` | Purchase Items | Setup | **Redirects** to `/items?tab=purchase` |
| `/issues` / `/data-health` / `/backup` | `src/routes/{issues,data-health,backup}.tsx` | Issues / Health / Backup | Setup | Active |
| `/settings` / `/control-room` | `src/routes/{settings,control-room}.tsx` | Settings / Control Room | Setup | Active (`control-room` in Ctrl+K only)|

*Mismatches:* `/items` PageMeta is "Items Master" vs Sidebar "Items". `/casting/materials` Sidebar is "Materials" vs Ctrl+K "Casting Materials". `/purchase-items` & `/supplier-payments` redirect to sub-tabs.

## 2. Items Data Model (The Three Item Worlds)
| Attribute | Selling Items (`items`) | Purchase Items (`purchase_items`) | Casting Materials (`casting_materials`) |
| :--- | :--- | :--- | :--- |
| **Collection Name** | `items` | `purchase_items` | `casting_materials` |
| **Fields** | `name`, `default_rate`, `type`, `unit`, `bag_weight`, `group` | `name`, `active` | `name`, `code`, `category`, `is_active` |
| **Unique Indexes** | None in PB migration (app enforces unique) | `idx_purchase_items_name_unique` ON (`name`)| None (managed via sync helper) |
| **Active Flag?** | **NO** (Missing active field) | **YES** (`active: bool`) | **YES** (`is_active: bool`) |
| **Created By** | `/items`, Muse AI draft creation | `/items`, seeds, quick-add | `syncCastingMaterialMaster`, `/casting/new-session` |
| **Current Manager** | `src/routes/items.tsx` (Tab 1: Selling) | `src/routes/items.tsx` (Tab 2: Purchase) | Report in `materials.tsx`; CRUD in `casting.ts` |
| **Existing CRUD** | Full CRUD (`items.ts:88-125`) | Create, Read, Rename, Toggle Active, Delete | Load, Create, Update, Merge (`casting.ts:265-330`) |
| **Referenced By** | `bill_items.item` (id) + `item_name` (copy) | `purchase_bill_lines.item` (id) + `item_name` | `casting_batch_inputs.material` (id) + `material_name` |
| **"Used" Rule** | Exists in `bill_items` (`item == id` \| `item_name`) | Exists in `purchase_bill_lines` (`item == id` \| name)| Exists in `casting_batch_inputs` (`material == id` \| name)|

*Cross-Module Item Linking in Code:* `src/domain/purchase-dashboard.ts:145-148` links casting inputs to purchase items by substring matching (`if (rawName.includes('brass')) targetKey = 'brass scrap' else if (rawName.includes('chol')) targetKey = 'chol'`).

## 3. Party Data Model (`customers` & `suppliers`)
| Attribute | Customers (`customers`) | Suppliers (`suppliers`) |
| :--- | :--- | :--- |
| **Fields** | `company_name`, `name`, `active`, `opening_balance` (₹ float), `opening_balance_date`, `phone`, `gstin`, `address`, `credit_limit`, `note`, `cust_type`, `aliases` | `company_name`, `contact_name`, `phone`, `gst_no`, `city`, `notes`, `opening_kacha_paise` (int), `opening_gst_paise` (int), `opening_balance_date`, `active` |
| **Active Flag / Balances** | `active: bool`, single opening balance (₹ float) | `active: bool`, dual pool balances in integer Paise (`kacha` & `gst`) |
| **Indexes / Edit Pages** | Unindexed in PB, edited in `src/routes/customers.tsx` | `idx_suppliers_company_name_unique`, edited in `src/routes/suppliers.tsx` & modals |
| **Masters vs Ledgers** | Master does contact, credit limit, aliases; Ledger does statement & exports | Master does pool opening balances & city; Ledger does bill/payment tracking |

*Export/Print Features to Survive:* Customer Statement PDF ([`ledger.tsx:177`](file:///home/arch/project/Kapil_pro/src/routes/ledger.tsx#L177)), Excel ([`ledger.tsx:203`](file:///home/arch/project/Kapil_pro/src/routes/ledger.tsx#L203)), Full ZIP bundle with bills/payments ([`ledger.tsx:131`](file:///home/arch/project/Kapil_pro/src/routes/ledger.tsx#L131)), HTML print ([`ledger.tsx:82`](file:///home/arch/project/Kapil_pro/src/routes/ledger.tsx#L82)), Supplier Ledger JPG ([`supplier-ledger.$supplierId.tsx:397`](file:///home/arch/project/Kapil_pro/src/routes/supplier-ledger.$supplierId.tsx#L397)), Bill Chitty Print/JPG ([`bill-chitty.tsx`](file:///home/arch/project/Kapil_pro/src/components/suppliers/bill-chitty.tsx)), Book ZIP ([`export-reports.tsx:251`](file:///home/arch/project/Kapil_pro/src/routes/export-reports.tsx#L251)).

## 4. Main Dashboard
- **Files & Loaders**: `src/routes/index.tsx`, `useDashboardData()` in `src/domain/dashboard.ts` (`['dashboard-summary', today]`), `loadCastingSessions()` in `src/data/casting.ts`.
- **Date Picker / Delta**: No date picker on dashboard today (hardcoded to today). "Vs last month" arrows exist for sales and collections (`kpis.salesVsLastMonth`, `kpis.collectionVsLastMonth`).
- **Data Shown Today**: Receivables & aging, Month Sales/Collections/Net, Trend chart, Collect Next list, Sold items, Activity feed, Casting intake/wire-out/cost. **Zero purchase data shown**.
- **Owner Metric Readiness**:
  - *Casting wire-out kg / wastage % / cost/kg*: **Ready** (`loadCastingSessions` in `casting.ts`; needs `(in - out)/in * 100` calc).
  - *Sales billed / received / receivable for month*: **Ready** (`buildDashboardSummary` in `dashboard.ts`; parameterize month).
  - *Purchase bought kg & ₹ / paid / payable*: **Ready** (`buildPurchaseDashboard` in `purchase-dashboard.ts`; loaders in `purchase-queries.ts`).
  - *Top suppliers by balance*: **Ready** (`loadSupplierContext` in `suppliers.ts` sorted by `totalBalancePaise`).
  - *Top customers by outstanding (+ oldest age)*: **Ready** (`actionRequired.riskRows` in `dashboard.ts`).
  - *Last 5 sales & purchase bills*: **Ready** (Sales: `loadRecentBills` in `bills.ts`; Purchase: `recentFeeds.recentBills` in `purchase-dashboard.ts`).

## 5. Module Settings
- **Today's Flag**: Client-only `localStorage` key `'kapil-module-settings-v1'` via `src/lib/module-settings.ts` with `{ castingEnabled: boolean }`.
- **Settings Page**: `src/routes/settings.tsx` houses Modules switch, Bill Entry defaults, Command bar shortcuts, and Backup links.
- **Where Read**: `sidebar-nav.tsx` (removes nav links), `app-shell.tsx` (filters Ctrl+K commands), `index.tsx` (hides Casting card).
- **Route Guards**: **None**. Entering `/casting/*` in browser URL bar bypasses toggle and loads page.
- **Auth Model**: Single-user localhost with unauthenticated public API rules (`""`) and Muse AI isolation (`@request.auth.email != "muse@..."`).
- **Proposed `app_settings` Collection**: Single record (`id: "global_settings"`, `purchase_enabled: bool`, `casting_enabled: bool`, public API rules).

## 6. Logs Pages
| Page | File | Source | Columns | Filters | Page? | CSV? | Actions |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **Sales Logs** | `src/routes/transactions.tsx` | `loadTransactionsContext` | Date, Party, Ref, Type, Amount, Note | Search, Kind, View | No | No | Edit, Trash, Restore |
| **Purchase Logs**| `src/routes/purchase-logs.tsx` | `purchaseBillsQueryOptions` | Date, Type, Ref, Supplier, Pool, Net, Status | Search, Type, Pool, Status | No | Yes | View, Add Bardan, Cancel, Pay |
| **Casting Logs** | `src/routes/casting/log.tsx` | `loadCastingSessions` | Date, Note, Input, Wire Out, Loss %, Cost/kg | Search, View | No | No | Edit, Trash, Restore |
*Duplications to Unify*: Identical search headers, local trash stores (`kapil-*-trash-v1`), and unpaginated DOM trees. Consolidate into `LogsShell` + `DataTable`.

## 7. Reports
- `monthly-sales-calendar.tsx`: Loads `loadCalendarMonthData` (`calendar-month.ts`). Covers daily sales bills, payments, items, brass rates. **No purchase or casting data**.
- `monthly-report.tsx`: Loads `loadDashboardCollections` (`dashboard.ts`). Covers sales, collections, party risk, gas breakdown. **No purchase or casting data**.
- `export-reports.tsx`: Loads `buildBackupSnapshot` (`backup.ts`). Backs up customers, items, bills, bill_items, payments. **No purchase or casting data**.

## 8. AI Drafts
- `bill_drafts`: Staged by Muse AI from WhatsApp. Approving routes to `/new-bill` prefilled; bill save marks draft `accepted`.
- `payment_drafts`: Staged by Muse AI from bank/UPI SMS. Approving directly executes `savePaymentFromDraft` into `payments`.
- `/drafts` Filters: Status (`pending`/`accepted`/`rejected`/`all`), Type (`all`/`bills`/`payments`), Search text. Paged at 25/page.
- *Needed for Purchase & Casting*: New `target_module` discriminator, purchase draft schema (supplier, pool, lines, bardan), and prefill routing to `/new-purchase-bill` and `/casting/new-session`.

## 9. Delete / Deactivate Behaviour
| Table | Delete Type | Cascade Rule | Orphan Impact |
| :--- | :--- | :--- | :--- |
| `items` (Sales) | Hard delete (`items.ts:123`) | `bill_items.item` non-cascading | `bill_items` retains `item_name` text copy; `item` relation ID orphans |
| `purchase_items` | Hard delete (`suppliers.ts:465`) | `purchase_bill_lines.item` non-cascading | `purchase_bill_lines` retains `item_name` copy; relation ID orphans |
| `casting_materials`| Hard delete (`casting.ts:322`)| `casting_batch_inputs.material` non-cascading | Inputs retain `material_name` copy; relation ID orphans |
| `customers` | Soft deactivate (`active: false`)| No delete API in app | Relations preserved; historical ledger remains intact |
| `suppliers` | Soft deactivate (`active: false`)| No delete API in app | Relations preserved; historical FIFO allocations remain intact |

## 10. Design System
- **Primitives**: `src/components/ui/` contains standard wrappers (`button`, `table`, `form-field`, `input`, `panel`, `confirm-dialog`, `stat-tile`), but most are unintegrated (0 imports); pages use raw Tailwind.
- **Charts**: `recharts ^3.10.1` (`SalesCollectionTrendChart`, `PurchasedVsPaidTrendChart`, `PartyTrendChart`) + SVG bar charts (`RankedBarList`).
- **Shell & Titles**: `app-shell.tsx` sticky header owns page title/subtitle via `resolvePageMeta(pathname)`. `sidebar-nav.tsx` renders desktop rail and mobile bottom nav.

## 11. Tests & Tooling
- **Test Layout & Run**: Colocated `*.test.ts(x)` across `src/`. Run single: `npx vitest run src/domain/dashboard.test.ts`. Full verify: `npm run verify` (typecheck + test + build).
- **Git State**: Branch `feat/muse-integration`. Last 5 commits: `06de703`, `cc539d3`, `0d1c01b`, `a9d7fcb`, `d80df32`. 40 modified files, 33 untracked.

## 12. Risks & Conflicts vs Owner Goals
- **Cross-Module Coupling in Dashboard**: `src/domain/purchase-dashboard.ts:145-148` substring-matches casting inputs to purchase items. *Fix: Remove name matching; isolate module calculations*.
- **Local-Only Module Toggles**: `src/lib/module-settings.ts:28` stores settings in browser `localStorage`. *Fix: Move settings to PocketBase `app_settings` for cross-device sync*.
- **Unguarded Direct Route Access**: Disabling a module only removes sidebar links; URL navigation is unblocked. *Fix: Add `beforeLoad` route guard redirects in module route files*.
- **Mismatched Party Accounting Models**: Customers use Rupees float; Suppliers use dual integer Paise. *Fix: On unified `/ledger`, keep distinct tab controllers; never net or blend formulas*.
- **Duplicate In-Page Titles**: `items.tsx:157`, `export-reports.tsx:551`, `supplier-ledger.$supplierId.tsx:459` duplicate AppShell title. *Fix: Remove in-page `<h1>` tags*.
- **Unpaginated Table Memory Spikes**: All log pages load full datasets into DOM. *Fix: Add 25-row client pagination fallback and server date-filtering*.

## 13. Required Database Changes (List Only)
1. **`app_settings` Collection**: Single record (`id: "global_settings"`, `purchase_enabled: bool`, `casting_enabled: bool`). *Syncs module state across devices. Safe without modifying existing tables*.
2. **`active` field on `items` Collection**: Add `active: bool` (default true) to `items`. *Allows soft deactivation on Sale Items matching Purchase/Casting. Safe without touching existing data*.
3. **Formalize `casting_materials` Collection Rules**: Standardize list/view/create/update API rules for `casting_materials`. *Enables direct CRUD tab on Items page. Safe*.

## 14. Open Questions for the Owner
1. **Disabled Module Direct Navigation**: When a module is turned off in Settings, should direct URL entry redirect to `/` with an info toast, or show a "Module Disabled" screen? *(Recommended: Redirect to `/` with toast)*
2. **Item Delete Protection**: If an item has historical bills or furnace logs, should delete be blocked in the UI with a prompt to deactivate instead? *(Recommended: Block delete if used; offer "Deactivate")*
3. **Unused Item Deletion**: For newly created items with zero history, should delete be immediate with a confirm dialog, or move to trash? *(Recommended: Immediate delete with confirm dialog)*
4. **Main Dashboard Default View**: When all modules are active, should Dashboard default to a 3-module executive summary or lead with Sales Receivables? *(Recommended: 3-Module Executive Summary with month picker)*
5. **Party Ledger URL Tab**: On `/ledger`, should active tab (Customers vs Suppliers) sync with URL query (`/ledger?tab=suppliers`)? *(Recommended: Yes, sync with URL search parameter)*
6. **Supplier Ledger Statement Exports**: Should Supplier Ledger gain matching PDF, XLSX, and ZIP statement export bundles like Customer Ledger has? *(Recommended: Yes, build matching statement export)*
7. **Purchase Logs Audit Tab**: Should the Audit sub-tab remain inside Purchase Logs or move to Data Health? *(Recommended: Retain in Purchase Logs)*
8. **Shared Settings Scope**: Should `app_settings` in DB only store module switches, keeping UI preferences (bill item defaults, shortcuts) device-local? *(Recommended: Module switches in DB; UI shortcuts local)*
