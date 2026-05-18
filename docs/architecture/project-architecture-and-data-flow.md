# Billing Project Architecture and Data Flow

## Overview

This project is a React + Vite + TypeScript billing system backed by PocketBase.
It is organized with a layered architecture:

- **Routes/UI layer** (`src/routes`): screens and interaction logic
- **Data access layer** (`src/data`): PocketBase reads/writes
- **Domain layer** (`src/domain`): deterministic business calculations
- **Shared utilities** (`src/lib`): formatting, date helpers
- **App shell/providers** (`src/app`, `src/components/layout`): app-wide wiring, navigation, query defaults

Core product areas:

- Dashboard (`/`)
- Bills (`/new-bill`)
- Payments (`/new-payment`)
- Customers master (`/customers`)
- Party ledger analytics (`/ledger`)
- Company report (`/monthly-report`)
- Items master (`/items`)
- Backup/export/validation (`/backup`)

## Technology Stack

- **Frontend:** React 19, TanStack Router, TanStack Query, Tailwind
- **Backend:** PocketBase
- **Build/Tooling:** Vite, TypeScript, Vitest

## Authentication and Access Model

- App uses PocketBase `users` auth (email/password).
- Login UI is password-only; email is configured by env (`VITE_LOGIN_EMAIL`).
- Successful login writes PocketBase auth state (`pb.authStore`) and a 90-day local session marker.
- On app boot, expired/missing session or invalid auth shows login gate before routing/screens render.
- Business collection access rules require `@request.auth.id != ""` for list/view/create/update/delete.
- Network hardening expects direct container ports blocked externally (`8088`, `8090`) with access via domain proxy only.

## Data Model (PocketBase)

Main collections used by app:

- `customers`: master party data (`name`, `opening_balance`, `active`, optional metadata fields)
- `items`: item master (`name`, `default_rate`)
- `bills`: bill header (`book_no`, `bill_no`, `customer`, `date`, transport/GST metadata)
- `bill_items`: bill lines (`bill`, `item_name`, `qty`, `rate`, `amount`, `bags`)
- `payments`: payment entries (`customer`, `date`, `amount`, `mode`, `note`)

Current operational schema notes:

- `bills` and `payments` include `created` and `updated` fields and these are consumed by in-memory sort tie-breakers.
- `bills` includes persisted `status` (`pending`, `partial`, `paid`) for dashboard/status views.
- Indexes currently configured through PocketBase admin API:
  - `bills(date)`, `bills(customer)`
  - `payments(date)`, `payments(customer)`
  - `bill_items(bill)`

## Layer Responsibilities

### Route Layer (`src/routes`)

Routes handle:

- UI composition
- user interaction state (filters, forms, selected rows)
- query and mutation orchestration via React Query
- status/error text for operator feedback

Routes should avoid direct heavy aggregation; those should be delegated to data/domain modules.

### Data Layer (`src/data`)

Data modules provide:

- typed mapping from PocketBase records into app structures
- collection-level read/write functions
- backup snapshot generation and CSV conversion

Implemented modules include:

- `bills.ts`, `payments.ts`, `customers.ts`, `ledger.ts`, `dashboard.ts`, `items.ts`, `backup.ts`

### Domain Layer (`src/domain`)

Domain modules provide reusable pure business logic:

- bill total math
- ledger timelines
- payment allocation
- customer and company summaries
- dashboard shaping

This is the preferred location for calculations requiring consistency across pages.

### Date Semantics and Balance Engine (Mandatory)

The project has two date fields with different roles:

- **Business date** (`date`): accounting meaning selected by user.
- **Record timestamp** (`created`): actual write time in PocketBase.

Permanent rules:

1. Sort by business date first, then created timestamp, then record id.
2. Use range-based filtering (`<= asOfDate`) for financial data inclusion.
3. Never duplicate outstanding formulas in pages/routes.
4. Use `computeCustomerOutstanding()` in `src/domain/records.ts` as the single outstanding engine.
5. After data mutations, invalidate all dependent query keys immediately; local reconciliation is allowed to prevent stale UI while refetch is pending.

## End-to-End Data Flow

### Bill Creation Flow

1. Route gathers form fields and line rows (`new-bill`)
2. Validation is applied
3. `saveBillWithItems` creates bill header and line items
4. Rollback logic cleans partial writes if item creation fails
5. Queries are invalidated so dashboard/ledger/company reflect latest state

### Payment Creation Flow

1. Route loads customer ledger context
2. Domain allocation preview computes oldest-first settlement
3. Save writes payment record
4. `computeBillStatuses()` recalculates and persists status for all bills of that customer
5. Relevant queries are invalidated

### Bill Status Engine

- Single source: `src/domain/bills.ts` (`computeBillStatuses`)
- Settlement order:
  1. payments sorted by business date then created timestamp (ascending)
  2. opening balance settled first
  3. remaining payments applied to bills in chronological order
- Result per bill: `pending`, `partial`, `paid`

### Company Report Flow

1. `loadDashboardCollections()` fetches core collections
2. Route builds month/day/customer maps
3. KPIs, aging, FY summaries, and heatmap datasets are derived
4. UI sections render executive + operational summary with actionable links to ledger

### Backup Flow

1. `buildBackupSnapshot()` fetches all critical collections
2. Export path:
   - JSON full snapshot
   - CSV bundle for spreadsheet portability
3. Validation path:
   - schema structure check
   - record counts
   - integrity checks (orphan lines, duplicate keys)

## Query and Cache Patterns

React Query is configured in app providers with low auto-refetch behavior.

Important patterns:

- Query keys are explicit per feature (for scoped invalidation)
- Mutations invalidate dependent keys (`dashboard`, `ledger`, feature keys)
- Avoid global blind invalidation unless necessary

## Robustness and Integrity Practices

Current implemented hardening:

- Bill save rollback on partial failure
- Safer dashboard outstanding calculation keyed by `customerId` (not customer name)
- Customer schema fallback limited to schema-like validation failures
- Print HTML escaping in party statement export path
- Backup validation includes referential and duplicate checks
- Heatmap/day grid generation uses dynamic week column count (no hard-coded grid assumption)

## UI Consistency Patterns

Common conventions used across screens:

- same container rhythm (`space-y-*`, card sections)
- compact metric card component style
- table zebra + sticky headers for large datasets
- empty states with action hints
- top-level status text for success/error feedback

## Known Design Trade-offs

- Some reports still aggregate from full client-side datasets for flexibility.
  For very large scale, migrate to server-side summaries/materialized views.
- Backup page currently supports export + validation (not restore write-back).
  This is deliberate for safety.

## Extension Guide for Next AI

Recommended next improvements:

1. Add transactional uniqueness enforcement for bill numbering at backend level
2. Keep all balance/aging changes centralized in `computeCustomerOutstanding()` only
3. Add integration tests for:
   - cross-page consistency (dashboard vs ledger vs company)
   - backup validator edge cases
4. Add backup restore dry-run and conflict reporting
5. Add paginated APIs for high-volume deployments

## File Map (High Signal)

- App wiring: `src/app/providers.tsx`
- Navigation: `src/components/layout/sidebar-nav.tsx`
- Dashboard: `src/domain/dashboard.ts`, `src/routes/index.tsx`
- Bills: `src/routes/new-bill.tsx`, `src/data/bills.ts`
- Payments: `src/routes/new-payment.tsx`, `src/data/payments.ts`, `src/domain/payment-ledger.ts`
- Customers: `src/routes/customers.tsx`, `src/data/customers.ts`, `src/domain/customers.ts`
- Party Ledger: `src/routes/ledger.tsx`, `src/data/ledger.ts`, `src/domain/ledger.ts`
- Company Report: `src/routes/monthly-report.tsx`
- Items: `src/routes/items.tsx`, `src/data/items.ts`
- Backup: `src/routes/backup.tsx`, `src/data/backup.ts`

