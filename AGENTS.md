# 🛡️ Kapil Billing — Canonical Agent Operating Guide

> **Single Source of Truth** for any AI agent or developer working in this repository.  
> **Host Environment:** Arch Linux / CachyOS (Development) · Windows PC (Production Local-Primary)  
> **Primary Command:** `npm run verify` (`npm run typecheck && npm test && npm run build`)

---

## 1. What This System Is

Kapil Billing is a high-speed, keyboard-first operations and financial management system built for a brass hardware manufacturer in Jamnagar, Gujarat. The entire software is operated by a **single user (the business owner)** across three operational modules:
1. **Sales Billing** (GST-compliant outbound invoice generation for brass hardware, customer ledgers, collections).
2. **Purchase / Procurement** (Scrap brass intake, supplier khata with dual Kacha & GST pools, weight deductions, bardan/bag tracking).
3. **Casting & Melting** (Foundry batches, scrap melting logs, wire-out yield tracking, casting bills).

**Stack:** React 19, TanStack Router & TanStack Query v5, Tailwind CSS v4, Vite, PocketBase (SQLite with WAL mode).

---

## 2. Core Architectural & Financial Invariants

### Rule 1: Strict Three-Module Isolation
Sales, Purchase, and Casting are **completely independent data worlds**.
- **Separate Items Tables:** `items` (Sales), `purchase_items` (Purchase), `casting_materials` (Casting). Even if an item shares the identical name (e.g. "Brass Scrap"), **never link them by ID, foreign key, or name matching**.
- **Separate Party Tables:** `customers` (Sales) and `suppliers` (Purchase). **Never net balances** across customers and suppliers into a single combined figure.

### Rule 2: Dual Monetary Precision Standard
- **Sales Module:** Floating-point Indian Rupees (`rate`, `cgst_rate`, `subtotal`, `grand_total`) with standard half-up rounding.
- **Purchase Module:** High-precision integer Paise and Milli-rupees:
  - `weight_g`: integer grams (1 kg = 1,000 g).
  - `rate_milli`: integer milli-rupees per kg (₹450.50/kg = 450,500 milli-rupees).
  - `amount_paise`: integer paise (₹1.00 = 100 paise).
  - **Dues and paid amounts are computed on read by `supplier-settlement`; they are never stored as columns.**
  - **NEVER convert purchase money to floats.**

### Rule 3: Soft-Delete vs Delete-Protection
- **Parties (Customers & Suppliers):** Never hard-deleted. They are deactivated (`active: false`) to preserve accounting ledger integrity.
- **Items:** Hard-delete is blocked if an item is referenced in any historical bill, line, or casting log. Referenced items can only be deactivated (`active: false`).

### Rule 4: Append-Only Database Migrations
- Never edit or rename existing files in `pb_migrations/`. PocketBase executes migrations strictly in chronological order by timestamp prefix.
- The designated production runtime is the Windows PC. When migrations are deployed, PocketBase applies pending migrations upon restart. The owner must run `windows\backup-kapil.ps1` before any restart.

### Rule 5: Module Toggles & Guards
- Purchase and Casting can be toggled on/off in `/settings`.
- State is stored in the database collection `app_settings` (`id: "globalsettings1"`, fields: `purchase_enabled`, `casting_enabled`), cached in `src/data/module-settings.ts`.
- When a module is disabled, its pages, navigation items, Ctrl+K commands, and tab headers are completely hidden. Deep links redirect to `/` via `src/routes/__root.tsx`.

### Rule 6: Muse AI Constraints
- External Muse automations interact only through draft collections: `bill_drafts` and `payment_drafts`.
- Muse has **zero direct write access** to live ledgers, bills, or payment records. All drafts must be approved by the owner via `/drafts`.

---

## 3. Business Rules That Must Not Drift

### Sales Accounting & Numbering Rules
1. **Financial Ordering:** Financial records must always sort strictly by: business date (`date`), then created timestamp (`created`), then record `id`.
2. **Range-Based Inclusion:** Ledger queries and balances use range-based inclusion (`<= asOfDate`), never exact-day equality.
3. **Bill Books of 50:** A physical bill book holds exactly 50 bills and its book number is also its first bill number (Book 1: 1–50, Book 51: 51–100, Book 101: 101–150). Bill numbers run continuously across books and are never reused. All book and sequence calculations must go through `src/domain/bill-books.ts`.
4. **Centralized Outstanding & Status:** Customer outstanding balances must only be computed through `computeCustomerOutstanding()` in `src/domain/records.ts`. Bill payment statuses (`pending`, `partial`, `paid`) must only be computed through `computeBillStatuses()` in `src/domain/bills.ts`.
5. **React Query Invalidation:** All write operations must immediately invalidate affected query keys using the centralized helpers in `src/app/query-invalidation.ts`.
6. **Market Rate Lookup:** `brass_rates` is the source of truth for historical brass market rates. The official bill market rate is `vilaity`. Backdated bills must look up the exact saved day first, and fallback to the nearest earlier saved day.

### Purchase Procurement & Settlement Rules
1. **Bardan (Bags) Settlement per Entry:** Gunny bags are settled per entry using one of four methods: `deduct` (credit = bag kg × chosen line rate), `in_kind` (settled physically with note, zero money), `cash_back` (information memo only, no effect on payable), or `advance` (creates a `bardan_advance` credit inside the bill's pool). Several entries may exist per bill. A bill shows "bardan pending" until at least one entry exists.
2. **Strict Pool Separation:** `kacha` and `gst` balance pools never cross during automatic FIFO allocation, and manual payment pins must strictly remain inside the payment's own pool.
3. **Computed Whole-Rupee Net:** Bill net amount is always rounded to a whole rupee with a computed round-off (never entered manually).
4. **GST vs RCM Liability:** Standard GST is added directly to the supplier payable amount. Reverse Charge Mechanism (RCM) is displayed as our tax liability to the government and is NOT added to the supplier payable.
5. **Granular Payment Kinds:** Outward payments support five exact kinds: `payment` (reduces what we owe), `paid_on_behalf` (transporter/labour paid for supplier; reduces what we owe), `settle_off` (penny write-off; reduces what we owe), `refund_received` (vendor refund to us; increases what we owe), and `bardan_advance` (credit consumed by FIFO within the bill's pool).
6. **FY-Based Inward Numbers:** Inward numbers (`in_no`) follow an annual financial year sequence (e.g. `IN-2627-0001`) and are never reused. Cancelled bills retain their sequence number.
7. **Internal-Only Benchmark:** Market premium vs vilaity and private notes are strictly internal management tools and are never printed or exported.
8. **No Auto-Stock:** No automated inventory coupling between purchase scrap, casting output, and sales stock.
9. **Title Case Master Item Names:** Item names are normalized to Title Case and unique only within their own master tab.
10. **Full-Page Chitty Inspection:** Viewing a purchase bill is always a dedicated full page (`/purchase-bills/$billId`), never a side drawer.

---

## 4. Protected Paths & Live Runtime Safety

### Protected Paths (Do Not Delete or Overwrite Without Explicit Review)
- `pb_migrations/` — Append-only PocketBase migration files.
- `runtime/` — Git-ignored live production binaries, databases, and logs.
- `database-transfer/` — Windows database backup/transfer archives.
- `.env*` — Environment secrets and instance configurations.
- `windows/` — Production operational PowerShell scripts (`start-kapil.ps1`, `stop-kapil.ps1`, `health-check.ps1`, `backup-kapil.ps1`, `restore-kapil.ps1`).
- Scripts referenced by `package.json` or Windows scheduled tasks.

### Live Runtime Safety Rule
- **NEVER run tests, seeds, or migrations against the live production runtime** (`runtime/data/data.db`).
- Automated tests and test suites must only run against in-memory mock clients or isolated disposable databases.
- On Windows production, PocketBase binds only to `127.0.0.1:8090` and Caddy binds to `127.0.0.1:4174`. Never change listeners to `0.0.0.0` or expose them to a public network.
- Never edit or replace an active SQLite database directly; always execute the operator stop and backup scripts first.

---

## 5. ⛔ Never Do This List

1. **NEVER link items or parties across modules:** Sales, Purchase, and Casting do not share foreign keys or name-matching heuristics.
2. **NEVER net customer and supplier balances:** Keep customer receivables and supplier payables strictly isolated.
3. **NEVER use floats for Purchase calculations:** Always use integer grams, milli-rupees, and paise.
4. **NEVER edit, rename, or reorder applied migrations in `pb_migrations/`:** Always create a new file with an increasing timestamp.
5. **NEVER write raw Tailwind styling where a kit component exists:** Use `Panel`, `DataTable`, `StatusChip`, `MoneyCell`, `ConfirmDialog`, `buttonClass`, `inputClass`.
6. **NEVER introduce side drawers or complex slide-overs:** Modals must be centered, focused dialogs. Viewing a bill is a full page.
7. **NEVER use blue for primary action buttons:** Primary buttons must use `bg-slate-900 text-white`. Blue is strictly reserved for selections and informational badges.
8. **NEVER read, import from, or copy patterns from `archive/` or `docs/archive/`:** Archived files contain obsolete and dropped architectures.

---

## 6. Codebase Layout & Directory Map

```
Kapil_pro/
├── src/
│   ├── routes/              # TanStack Router file-based routes
│   ├── components/
│   │   ├── ui/              # Reusable UI primitives & business kit
│   │   ├── layout/          # AppShell, SidebarNav, FocusLayout, QuickSearch
│   │   ├── logging/         # LogsShell, LogsPager, LogsDateWindow
│   │   ├── billing/         # Bill print layout, print styles, CSS
│   │   ├── suppliers/       # Purchase bill entry, physical Chitty, modals
│   │   ├── reports/         # Recharts charts and summary tables
│   │   ├── items/           # Master item management components
│   │   └── ledger/          # Party ledger rail and trend visuals
│   ├── data/                # PocketBase API queries, mutations, reliability wrappers
│   ├── domain/              # Pure calculations: bill-books, supplier-settlement, units
│   ├── lib/                 # Formatting (inr-format), dates, commands, exports
│   └── app/                 # Router bootstrap, React Query provider, errors
├── pb_migrations/           # PocketBase JavaScript migration scripts
├── windows/                 # Windows production scripts (start, stop, backup, restore)
├── docs/
│   ├── architecture/        # CURRENT-STATE.md, DECISIONS.md
│   ├── ui/                  # CONVENTIONS.md (design system, component catalog)
│   ├── features/            # Active restructure plans & progress notes
│   ├── operations/          # Runbooks, disaster recovery, declutter inventory
│   └── archive/             # Historical specs, audits, muse prompts, old notes
```

---

## 7. Verification Commands

Run verification after every code change:
```bash
npm run verify                           # Typecheck + Vitest + Vite build
cd windows && npx vitest run windows-package.test.ts  # Windows production package checks
```

For deeper architectural context, consult:
- `docs/architecture/CURRENT-STATE.md` (Live routes, collections, data flows)
- `docs/architecture/DECISIONS.md` (One-line rationale for every architectural decision)
- `docs/ui/CONVENTIONS.md` (Design system, component catalog, banned patterns)
- `docs/README.md` (Complete documentation index)
