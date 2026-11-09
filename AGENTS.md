# 🛡️ Kapil Billing — Canonical Agent Operating Guide

> **Single Source of Truth** for any AI agent or developer working in this repository.  
> **Host Environment:** Arch Linux / CachyOS (Dev) · Windows PC (Designated Production Host)  
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
  - `amount_paise`, `kacha_due_paise`, `gst_due_paise`: integer paise (₹1.00 = 100 paise).
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
- When a module is disabled, its pages, navigation items, Ctrl+K commands, and tab headers are completely hidden. Deep links redirect to `/`.

### Rule 6: Muse AI Constraints
- External Muse automations interact only through draft collections: `bill_drafts` and `payment_drafts`.
- Muse has **zero direct write access** to live ledgers, bills, or payment records. All drafts must be approved by the owner via `/drafts`.

---

## 3. ⛔ Never Do This List

1. **NEVER link items or parties across modules:** Sales, Purchase, and Casting do not share foreign keys or name-matching heuristics.
2. **NEVER net customer and supplier balances:** Keep customer receivables and supplier payables strictly isolated.
3. **NEVER use floats for Purchase calculations:** Always use integer grams, milli-rupees, and paise.
4. **NEVER edit, rename, or reorder applied migrations in `pb_migrations/`:** Always create a new file with an increasing timestamp.
5. **NEVER write raw Tailwind styling where a kit component exists:** Use `Panel`, `DataTable`, `StatusChip`, `MoneyCell`, `ConfirmDialog`, `form-control-classes.ts`.
6. **NEVER introduce side drawers or complex slide-overs:** Modals must be centered, focused dialogs.
7. **NEVER use blue for primary action buttons:** Primary buttons must use `bg-slate-900 text-white`. Blue is strictly reserved for selections and informational badges.
8. **NEVER read, import from, or copy patterns from `archive/` or `docs/archive/`:** Archived files contain obsolete and dropped architectures.

---

## 4. Codebase Layout & Directory Map

```
/home/arch/project/Kapil_pro/
├── src/
│   ├── routes/              # TanStack Router file-based routes (41 routes)
│   ├── components/
│   │   ├── ui/              # Reusable UI primitives & business kit
│   │   ├── layout/          # AppShell, SidebarNav, FocusLayout, QuickSearch
│   │   ├── logging/         # LogsShell, LogsPager, LogsDateWindow
│   │   ├── billing/         # Bill print layout, print styles, CSS
│   │   ├── suppliers/       # Purchase bill entry, physical Chitty, modals
│   │   ├── reports/         # Recharts charts and summary tables
│   │   ├── items/           # Specialized item components
│   │   └── ledger/          # Party ledger rail and trend visuals
│   ├── data/                # PocketBase API queries, mutations, reliability wrappers
│   ├── domain/              # Pure calculations: bill-books, supplier-settlement, units
│   ├── lib/                 # Formatting (inr-format), dates, commands, exports
│   └── app/                 # Router bootstrap, React Query provider, errors
├── pb_migrations/           # PocketBase JavaScript migration scripts
├── windows/                 # Windows production scripts (start, stop, backup, restore)
├── docs/
│   ├── architecture/        # CURRENT-STATE.md, DECISIONS.md, AI-CONTEXT.md
│   ├── ui/                  # CONVENTIONS.md (design system, component catalog)
│   ├── features/            # Active restructure plans & progress notes
│   ├── operations/          # Runbooks, disaster recovery, declutter inventory
│   └── archive/             # Historical specs, audits, muse prompts, old notes
```

---

## 5. Verification Commands

Run verification after every code change:
```bash
npm run verify                           # Typecheck + Vitest + Vite build
npx vitest run windows/windows-package.test.ts  # Windows production package checks
```

For deeper architectural context, consult:
- `docs/architecture/CURRENT-STATE.md` (Live routes, collections, data flows)
- `docs/architecture/DECISIONS.md` (One-line rationale for every architectural decision)
- `docs/ui/CONVENTIONS.md` (Design system, component catalog, banned patterns)
- `docs/README.md` (Complete documentation index)
