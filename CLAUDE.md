# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install deps: `npm install`
- Start frontend dev server: `npm run dev`
- Start local PocketBase container: `npm run db:start`
- Tail local PocketBase logs: `npm run db:logs`
- Generate TanStack Router tree: `npm run router:generate`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Run full test suite: `npm run test`
- Run one test file: `npx vitest run src/lib/commands.test.ts`
- Run one named test: `npx vitest run src/lib/commands.test.ts -t "parses bill command"`
- Build production app: `npm run build`
- Preview production build: `npm run preview -- --host 0.0.0.0 --port 4174`
- Full verification pass: `npm run verify`

## Runtime and environment

- Frontend stack: Vite + React 19 + TypeScript.
- Routing uses TanStack Router with generated route tree in `src/routeTree.gen.ts`; regenerate with `npm run router:generate` after route changes.
- Data is loaded directly from PocketBase in the frontend. Default PocketBase base URL is `/pb` from `src/app/env.ts:1`.
- Login is gated in-app via PocketBase `users` auth plus a 90-day local session marker in `src/app/auth.ts:1`.
- Dev/preview server includes a custom Vite middleware proxy for brass market-rate RSS at `/api/market-rate` in `vite.config.ts:8`.

## High-level architecture

The app is organized as a layered frontend over PocketBase:

- `src/routes`: page-level UI and workflow orchestration.
- `src/data`: PocketBase reads/writes, record mapping, and mutation helpers.
- `src/domain`: pure business logic and cross-page calculations.
- `src/lib`: UI-agnostic helpers such as dates, printing, command parsing, formatting, and search.
- `src/app` + `src/components/layout`: app bootstrapping, providers, shell, navigation, sync status, quick search, and global command UI.

Important wiring:

- App boot: `src/main.tsx:1`
- Router registration: `src/app/router.tsx:1`
- Global providers / React Query defaults / auth gate: `src/app/providers.tsx:1`
- Root shell and global quick-search / command-bar UX: `src/components/layout/app-shell.tsx:1`

## Core product flows

Main business areas exposed through routes:

- dashboard and KPI aggregation
- bill creation and printing
- payment entry and ledger tracking
- stock entry and stock audit views
- calendar and exports/reporting
- customer/item masters
- backup and data-health checks
- control-room/admin command configuration

A notable UX pattern in this repo is the keyboard-first command system:

- parsing lives in `src/lib/commands.ts:1`
- the shell opens commands globally and routes pending actions into page workflows via session storage
- quick search is also global and is driven from the app shell, not individual pages

## Data flow and business logic boundaries

Use these boundaries consistently when changing behavior:

- PocketBase access belongs in `src/data/*`.
- Deterministic calculations belong in `src/domain/*`.
- Routes should compose queries/mutations and UI state, but avoid duplicating financial logic.

Examples:

- Dashboard aggregation is built in `src/domain/dashboard.ts:1` from data-layer collection loads.
- Bill creation persists header + line items and handles rollback in `src/data/bills.ts:1`.
- Payment persistence and read-after-write handling live in `src/data/payments.ts:1`.
- Bill status recalculation is centralized in `src/data/bill-statuses.ts:1` and `src/domain/bills.ts`.

## Business invariants that must not drift

These rules are called out in the repo README and architecture docs and should stay centralized:

- Treat business date (`date`) and record creation timestamp (`created`) as separate concepts.
- Financial ordering must be: business date, then created timestamp, then record id.
- Financial inclusion logic is range-based (`<= asOfDate`), not exact-date equality.
- Outstanding balance calculations must stay centralized in `computeCustomerOutstanding()` in `src/domain/records.ts:55`.
- Bill status persistence must stay centralized through bill-status recalculation, not recomputed ad hoc in routes.
- After write operations, invalidate affected React Query keys immediately.

## PocketBase model shape

The main operational collections are:

- `customers`
- `items`
- `bills`
- `bill_items`
- `payments`
- `brass_rates`

Current repo assumptions from README/docs:

- `bills` and `payments` include `created` and `updated` in API responses.
- `bills` persists `status` as `pending`, `partial`, or `paid`.
- `brass_rates` is the historical source of truth for brass market rates.
- On backdated bill flows, the app should prefer the exact saved day, then the nearest earlier saved day.

## Query/cache behavior

React Query is configured centrally in `src/app/providers.tsx:14` with:

- `staleTime: 60_000`
- no refetch on window focus or reconnect
- refetch on mount when stale/invalidated
- retry count of 1

When debugging stale data, inspect invalidation paths before changing page code.

## Deployment and operations context

This repository includes deployment/runtime artifacts for a low-RAM VPS setup:

- `Dockerfile`
- `docker-compose.yml`
- `nginx.conf`
- `scripts/deploy-low-ram.sh`
- `docs/operations/deploy/`

PocketBase local runtime data lives in `pb_data/`. Treat it as runtime state, not normal source code.

## High-signal entry points by task

When changing these areas, read the paired files first:

- Bill creation / numbering / rollback: `src/routes/new-bill.tsx`, `src/data/bills.ts:1`, `src/domain/billing-calculations.ts`
- Payment entry / ledger settlement: `src/routes/new-payment.tsx`, `src/data/payments.ts:1`, `src/domain/payment-ledger.ts`, `src/domain/records.ts:55`
- Bill status behavior: `src/data/bill-statuses.ts:1`, `src/domain/bills.ts`
- Dashboard KPI mismatches: `src/data/dashboard.ts`, `src/domain/dashboard.ts:1`, `src/domain/records.ts:55`
- Global command bar / keyboard workflows: `src/components/layout/app-shell.tsx:1`, `src/lib/commands.ts:1`, `src/lib/commands.test.ts`
- Quick search behavior: `src/components/layout/app-shell.tsx:1`, `src/data/quick-search.ts`, `src/components/layout/quick-search-preview.tsx`
- Market-rate behavior: `src/domain/market-rate.ts`, `src/data/market-rate*` , `vite.config.ts:8`
- Stock flows: `src/routes/stock.tsx`, `src/routes/stock-in.tsx`, `src/data/stock.ts`
- Export / backup flows: `src/routes/export-reports.tsx`, `src/data/backup.ts`, `src/routes/backup.tsx`

## Useful deeper references

For details beyond this summary, start with:

- `README.md`
- `docs/README.md`
- `docs/architecture/project-architecture-and-data-flow.md`
- `docs/features/`
- `docs/operations/security-auth-setup.md`
- `cursor_project_scope_and_organization_d.md`
