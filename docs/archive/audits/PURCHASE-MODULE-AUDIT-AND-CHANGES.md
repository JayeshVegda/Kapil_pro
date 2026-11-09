# Purchase Module Audit and Changes

**Project:** Kapil Pro Billing & Casting  
**Workstation:** Arch Linux  
**Audit and implementation date:** 7 November 2026  
**Status:** Changes are present in the local worktree; they have not been committed.

## Scope

This work focused on the purchase module and the areas connected to its daily use:

- Purchase bills list, bill detail and settlement information
- New purchase bill entry, material selection, bill-day payment and live preview
- Supplier payment entry and bill allocation preview
- Supplier directory and account summary
- Purchase data validation, settlement calculations, audit information and batch writes
- Running the project locally on Arch Linux and checking desktop and mobile layouts

The existing selling module was treated as an important regression area. Browser checks for this work used the local application and did not save business records.

## Findings before the changes

### Purchase bill list

The list header and filter controls took more room than needed. The settlement information shown for a selected bill used large cards and was harder to scan than necessary. Operators needed a compact view that makes bill amount, paid amount and remaining due easy to compare.

### New purchase bill form

The form did not maintain a clear alignment and hierarchy across its fields and sections. The item suggestion list could appear behind surrounding content. The page also lacked a convenient way to record the payment made on the bill date, even though that payment is part of recording the purchase.

The live preview and supplier brief needed to update with the entered bill data. A basic subtraction preview could also misstate the new bill's remaining amount where the supplier already had credits or advances.

### Supplier payment entry

The allocation preview was difficult to understand and needed to be driven by the actual payment amount, date, pool, payment type and bill priorities. The preview should show how much is applied, which bills are affected and what balance remains after the payment.

### Supplier directory

The supplier page needed to support the same practical account workflow as the customer ledger: find a supplier, understand the current position, and proceed to the ledger, a new bill or a payment without relying on an overly wide table.

### Project and local runtime

The app needed to be checked in the user's Arch Linux environment while respecting the local PocketBase and Caddy setup. Database safety and the single writable local database remain important project constraints.

## Changes made

### Purchase bills and bill detail

- Compactened the bill list header and filter controls.
- Reworked the selected bill settlement summary around bill amount, paid so far and remaining due.
- Kept the bill chitty and its bill actions available alongside the settlement information.

### New purchase bill

- Reorganized the form into clearer sections with improved alignment and responsive layout.
- Corrected the material item dropdown stacking so suggestions remain visible over nearby content on desktop and mobile.
- Added an optional **Payment made on bill day** section. The payment is submitted with the bill and applied to that bill first.
- Added a compact live bill preview with bill amount, payment recorded today, due after credits, item count, weight and pool.
- Kept the print layout available through an expandable preview to avoid taking over the entry page.
- Improved the supplier brief to show the projected supplier amount due and current pool balances, advance, open bill count and latest purchase information.
- Used the supplier settlement calculation for the projection so existing supplier credits are reflected in the bill due and overall projected balance.
- Tightened input validation so incomplete material lines cannot be silently accepted as complete lines.

### Supplier payment and allocation

- Connected the allocation preview to the supplier settlement domain logic.
- Made the preview respond to the entered payment amount and show before-payment balance, payment amount, amount applied to dues, remaining balance and settlement coverage.
- Showed the bill-by-bill allocation preview with oldest bills settled first and support for prioritizing selected bills.
- Kept refunds from being assigned a bill pin that would incorrectly suggest ordinary bill settlement.

### Supplier directory

- Replaced the wide directory table layout with a searchable supplier list and a selected supplier account panel.
- Added summary figures for total suppliers, amount owed, available advance and pending bardan.
- Added supplier-level Kacha due, GST due, advance and bardan summary, with direct actions for ledger, new bill, payment and supplier maintenance.

### Data and reliability work

- Strengthened purchase bill and payment input validation.
- Improved handling of uncertain batch write results to avoid automatically retrying a write that may already have succeeded.
- Improved audit information for bill edits and made failed data reads visible rather than quietly treating them as empty results in the affected flows.
- Kept financial settlement and allocation work in the supplier settlement domain rather than duplicating it in page components.

### Arch Linux runtime

- Used the project's Linux scripts to back up the local data before database-affecting work.
- Verified the local PocketBase service and Caddy app service, including the PocketBase reverse proxy through Caddy.
- Left the services running after verification.
- The browser interaction checks did not submit bills or payments and did not create business records.

## Files and areas touched

The worktree contains changes in the purchase routes and supplier UI, supplier settlement and data modules, shared UI components, app layout, and Linux operator scripts. Principal areas include:

- `src/routes/new-purchase-bill.tsx`
- `src/routes/new-supplier-payment.tsx`
- `src/routes/purchase-bills/index.tsx`
- `src/routes/suppliers.tsx`
- `src/domain/supplier-settlement.ts`
- `src/data/suppliers.ts`
- `src/data/casting.ts`
- `src/components/suppliers/`
- `scripts/linux/`

There are additional shared-component, route, test, and support-file changes in the worktree. Review `git status --short` for the full file list. Existing unrelated edits were not discarded.

## Verification performed

### Automated checks

`npm run verify` completed successfully:

- TypeScript typecheck passed.
- **318 tests passed; 2 tests were skipped.**
- Production build completed successfully.

`npm run lint` completed with **0 errors and 59 warnings**. The three lint errors encountered during the work were corrected. The remaining warnings include existing hook dependency, explicit `any`, and compiler compatibility warnings; they are not reported as lint errors.

`git diff --check` passed with no whitespace errors.

### Browser checks

Using the local Arch Linux services, the purchase pages were opened at **1440 px desktop** and **390 px mobile** widths. The checks covered:

- Purchase bills list and selected bill summary
- Supplier directory and account panel
- New purchase bill entry, item suggestions, material line and bill-day payment preview
- Supplier payment entry and live payment impact preview
- Document width at both viewport sizes
- Browser console and page errors

The interaction audit reported no page errors and no horizontal document overflow. It also verified that changing the supplier payment from ₹10,000 to ₹20,000 recomputes the remaining balance, and that the bill-day payment updates the bill preview.

### Local service health

The Linux health check passed for:

- PocketBase at `127.0.0.1:8090`
- Caddy at `127.0.0.1:4174`
- The PocketBase health endpoint through Caddy's `/pb` proxy

The local backup was created before the database-affecting work under the ignored `runtime/backups/` directory. Runtime files and credentials are excluded from this report.

## Remaining items

- Lint still reports 59 warnings that can be reviewed separately.
- The worktree contains uncommitted changes. No commit was created.
- Browser checks exercised previews and navigation but intentionally did not submit a real purchase bill or supplier payment. The first real transaction should be checked against the supplier ledger and purchase logs after entry.
- The project's existing Windows operator documentation describes its Windows-primary setup. The Linux session was operated through the project's Linux scripts and local Arch runtime; the owner should keep the intended machine and database authority explicit when moving between environments.

## Operational safety notes

- The project instructions designate `runtime/data/data.db` as the sole writable database on the Windows-primary setup and prohibit editing an active SQLite database directly.
- No database file was manually edited or copied over an active database as part of the browser checks.
- Do not commit `runtime/`, `.env` files, backups, executables, logs or credentials. These paths are ignored locally; check `git status --ignored` before any commit.
- Before future database-affecting work, use the appropriate local health-check and backup scripts for the machine that owns the writable database.
