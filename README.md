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

