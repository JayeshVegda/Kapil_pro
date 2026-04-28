# Kapil Billing

Production-oriented billing and ledger application for trading workflows.

## Repository Layout

- `src/` - application code (routes, domain logic, data layer, UI components)
- `public/` - static public assets
- `scripts/` - utility scripts (seeders and maintenance scripts)
- `docs/` - active project documentation
  - `docs/architecture/` - architecture and data flow docs
  - `docs/features/` - page/feature behavior notes
  - `docs/operations/` - deployment and runbook-style docs
  - `docs/data/` - schema and migration references
- `archive/` - historical and heavy reference material not part of active production surface
  - `archive/demo/` - legacy demo app and zip
  - `archive/reference/` - old references and source documents
  - `archive/runtime-snapshots/` - archived local DB snapshots
- `pb_data/` - local runtime PocketBase data directory (kept minimal in repo)

## Run Locally

```bash
npm install
npm run db:start
npm run dev
```

## Production Build

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4174
```

## Date and Balance Rules

- Business date (`date`) and save timestamp (`created`) are different; do not mix them.
- Sorting for financial timelines: business date, then created timestamp, then id.
- Financial inclusion is range-based (`<= asOfDate`), never exact-day equality.
- Outstanding math must stay centralized in `src/domain/records.ts` via `computeCustomerOutstanding()`.
- After write operations, invalidate all affected React Query keys immediately.

## PocketBase Schema Updates (2026-04-28)

- `bills` and `payments` now include `created` and `updated` fields in API responses.
- Indexes added:
  - `bills(date)`, `bills(customer)`
  - `payments(date)`, `payments(customer)`
  - `bill_items(bill)`
- `bills` now includes plain text `status` (`pending`, `partial`, `paid`).
- Bill status is persisted and recalculated after payment saves and bill saves using `computeBillStatuses()` in `src/domain/bills.ts`.
- `brass_rates` is now the source of truth for historical brass market rates.
  - `vilaity` is the official bill market rate used by `new-bill`.
  - `honey_gulf` and `honey_europe` are preserved for historical reference.
  - Backdated bills load exact-day rate first, then nearest earlier saved day.
- Market rates are no longer stored as active history in `misc_expenses`.
- Maintenance scripts added in `scripts/`:
  - `backfill-created-updated.mjs`
  - `backfill-created-updated-sqlite.py`
  - `import-brass-rates.mjs`

