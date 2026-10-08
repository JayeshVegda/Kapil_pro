# CLAUDE.md — Kapil Pro Preview & Development

This file provides guidance to Claude Code (`claude`) when working with code in this repository.

## Environment: Isolated Preview & Sandbox
- **Location**: `C:\Site_imp\kapil-preview` (branch: `dev`)
- **Preview Frontend**: `http://127.0.0.1:5173` (Vite)
- **Preview PocketBase**: `http://127.0.0.1:8091` (`runtime/data/` sandbox DB)
- **Official Production**: `C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a` (running on `4174` & `8090`). **NEVER edit files in the official directory directly.**

## Development Commands
- Start Preview Sandbox: `.\start-preview.ps1`
- Stop Preview Sandbox: `.\stop-preview.ps1`
- Frontend dev server: `npm run dev`
- Generate TanStack Router tree: `npm run router:generate`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Run test suite: `npm run test`
- Run one test file: `npx vitest run src/domain/bill-preview.test.ts`
- Build check: `npm run build`
- Full verification pass: `npm run verify`

## Architecture & Code Boundaries
- `src/domain`: Pure financial & business logic (accounting math, bill aggregation, balances). Zero React or DB dependencies. All changes must have unit tests in `src/domain/*.test.ts`.
- `src/data`: PocketBase queries, record mapping, and mutations.
- `src/routes`: TanStack Router page views and workflow orchestration. Keep UI lean.
- `src/components`: Shared UI primitives and dialogs.

## Migration to Official Production
Once an update is verified in preview:
1. Commit & push on `dev`: `git push origin dev`
2. Merge into `main`: `git checkout main && git merge dev && git push origin main && git checkout dev`
3. In `C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a`, run `.\windows\update-production.ps1`
