# Kapil Billing

Production billing and ledger application for Kapil Trading workflows. The stack is a Vite/React frontend backed by PocketBase, with operational scripts and deployment configs kept in-repo for a low-RAM VPS setup.

## What This Repo Contains

- bill creation, payment entry, transaction editing, customer and item management
- dashboard, ledger, reports, and print-friendly bill flows
- PocketBase-backed business data with production-oriented utility scripts
- deployment and operations notes for the current VPS-based hosting model

## Repository Structure

### App and Runtime

- `src/` - application code, domain logic, data layer, routes, and shared UI
- `public/` - static assets served by the frontend
- `pb_data/` - local PocketBase runtime directory; only minimal repo-safe scaffolding should live here

### Tooling and Deployment

- `scripts/` - maintenance, import, backfill, and deployment scripts
- `Dockerfile` - production frontend image build
- `docker-compose.yml` - container orchestration for the deployed stack
- `nginx.conf` - web/proxy config for the frontend container
- `vite.config.ts`, `tsconfig*.json`, `eslint.config.js` - build and lint configuration

### Documentation

- `docs/README.md` - documentation index
- `docs/architecture/` - architecture and data-flow notes
- `docs/features/` - feature/page behavior notes
- `docs/operations/` - deployment, incident, and audit notes
- `docs/data/` - schema, migration, and imported data references
- `cursor_project_scope_and_organization_d.md` - long-form project handoff and historical decision log

### Archived Material

- `archive/` - heavy or historical reference material not part of the active production surface

## Local Development

Install dependencies, start PocketBase locally, then run the frontend:

```bash
npm install
npm run db:start
npm run dev
```

Useful local commands:

```bash
npm run typecheck
npm run test
npm run build
npm run db:logs
```

## Production Workflow

Frontend production build:

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4174
```

For the current VPS deployment path, use the repo deployment script and container config already checked into the repository. See:

- `scripts/deploy-low-ram.sh`
- `docs/operations/doppler-secrets.md`
- `docs/operations/deploy/`
- `docs/operations/audits/vps-ram-and-restart-audit-2026-04-25.md`

## Business Rules That Must Not Drift

### Dates and Sorting

- Business date (`date`) and record timestamp (`created`) are different concepts.
- Financial ordering must use: business date, then created timestamp, then id.
- Inclusion logic is range-based (`<= asOfDate`), not exact-day equality.

### Outstanding and Status Logic

- Outstanding balance calculations must stay centralized in `src/domain/records.ts` through `computeCustomerOutstanding()`.
- Bill status persistence must stay centralized through `computeBillStatuses()` in `src/domain/bills.ts`.
- After write operations, all affected React Query keys should be invalidated immediately.

### Market Rate Rules

- `brass_rates` is the source of truth for historical brass market rates.
- `vilaity` is the official bill market rate used in `new-bill`.
- `honey_gulf` and `honey_europe` are preserved for historical reference only.
- Backdated bills should load the exact saved day first, then the nearest earlier saved day.
- Active market-rate history should not be stored in `misc_expenses`.

## PocketBase Notes

Recent schema/runtime expectations:

- `bills` and `payments` include `created` and `updated` in API responses.
- `bills` includes persisted `status` values: `pending`, `partial`, `paid`.
- historical brass rates live in `brass_rates`
- main supporting indexes in use:
  - `bills(date)`, `bills(customer)`
  - `payments(date)`, `payments(customer)`
  - `bill_items(bill)`

## Key Maintenance Scripts

- `scripts/deploy-low-ram.sh` - low-memory deployment path for the VPS
- `scripts/import-brass-rates.mjs` - imports and maintains historical brass rate data
- `scripts/import-opening-balances.mjs` - customer opening-balance import flow
- `scripts/import-legacy-and-fake.mjs` - legacy/fake data bootstrap path
- `scripts/backfill-created-updated-sqlite.py` - backfill helper for existing PocketBase rows
- `scripts/backfill-bags-from-qty.mjs` - recomputes bag counts from quantity data

## Documentation Entry Points

Start here when you need deeper context:

- `docs/README.md`
- `docs/architecture/project-architecture-and-data-flow.md`
- `docs/features/keyboard-first-new-bill-and-payment.md`
- `docs/operations/incident-notes.md`
- `cursor_project_scope_and_organization_d.md`
