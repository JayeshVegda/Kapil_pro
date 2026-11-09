# Purchase fixes implementation plan

**Goal:** fix all 11 purchase audit findings and verify the real combinations that the earlier tests missed.

**Architecture:** retain `src/domain` as the source of financial calculations, `src/data` as the persistence boundary, and route components as orchestration. Reuse small helpers for confirmed writes, purchase payment modes, receipt memos, and log metrics. Continue inline under the user's instruction to finish autonomously.

**Stack:** React 19, TypeScript, TanStack Query/Router, PocketBase JS SDK, Vitest, Bash.

## Constraints and decisions

- The user authorized all audit fixes and requested autonomous execution without questions.
- Reports and working documentation are stored in `AgentRouterWork/`.
- Preserve integer paise/grams/milli-rupees, separate Kacha/GST pools, and ordering by business date, created timestamp, then id.
- Use existing supported payment modes rather than introduce a new `bank` enum migration.
- Persist per-line receipt memos in versioned private-note metadata keyed by stable line id; no live schema migration is needed.
- Return successful batch response records directly. Preserve uncertain create identity and reconcile it before a retry can create a duplicate.
- Retain existing source edits and run `npm run verify`, lint, diff checks, and browser checks before completion.
- Financial/data-layer regressions require meaningful unit/boundary tests. Backup lifecycle checks use fake processes/services and synthetic files.

## Task 1 — Financial reconciliation

- [x] Add failing tests for negative opening advances, partial/excess credit, GST bardan tax/rounding, bardan advance plus generated payment, cancellation, and date-window balances.
- [x] Fix `src/domain/supplier-settlement.ts` to consume opening advances and record actual credits.
- [x] Fix `src/domain/supplier-ledger.ts` and `bundleToLedgerInput` in `src/data/suppliers.ts` to derive tax-aware bardan deltas, count advance once, and ignore parent-cancelled bardan.
- [x] Run the supplier domain/reconciliation tests and verify ledger closing equals settlement net position for each synthetic scenario.

## Task 2 — Write confirmation and entry contracts

- [x] Add data-boundary regressions for successful commit plus failed read, lost commit response, uncertain retry, validation rejection, and atomic related records.
- [x] Add a shared confirmed-batch helper with stable create identity and explicit uncertain-result errors.
- [x] Apply it to purchase bill, supplier payment, bardan, and related bill-update confirmation paths.
- [x] Centralize supported payment modes and reference requirements; remove BANK from the form.
- [x] Add versioned receipt-memo parse/format helpers, stable line ids for new bills, edit prefill, and print mapping.
- [x] Preserve pending confirmation across a data-module reload and recover committed receipt-memo snapshots after uncertain edits; final targeted data run: 18 passed.
- [x] Correct method-specific bardan display and actual credit rows in the chitty, list, and print flows.
- [x] Run targeted data, memo, and rendering tests.

## Task 3 — Audit and financial reporting

- [x] Add `purchase-logs-audit` to centralized query invalidation and verify using an actual QueryClient.
- [x] Extract cash/refund/non-cash classification and outstanding aggregation into `src/domain` with fixtures for opening-only and refund-only suppliers.
- [x] Update purchase logs labels, rows, exports, and KPI totals; preserve useful audit context for edited and cancelled records.
- [x] Exclude cancelled payments from available-advance mapping and extend the payment-mapping regression.
- [x] Verify logs and supplier/overview figures agree under the same scope.

## Task 4 — Linux backup lifecycle

- [x] Preserve the original PocketBase/Caddy state in both systemd and direct-process modes.
- [x] Restore that state in an EXIT trap on success and failure; verify stopped state before archiving.
- [x] Add synthetic lifecycle tests covering direct, systemd, already-stopped, and failed-archive cases.
- [x] Run shell syntax checks and synthetic tests; document reference operator commands and the limits of original-state restoration (not a production restore guarantee).

## Task 5 — Verification and handoff

- [x] Run corrected-behavior regressions and meaningful synthetic saved-record boundary checks.
- [x] Record the earlier `npm run verify` result (362 passed / 2 skipped; typecheck/build passed) and lint result (0 errors; warning count not retained). Audit-stage whitespace/health checks are historical, not current acceptance results.
- [x] Verify purchase list, new bill, supplier payment, supplier ledger, logs, print, and a sales regression screen at desktop/mobile widths: 28 browser checks passed.
- [x] Review the affected repair flows and fix evidenced overflow, memo-confirmation, and cancelled-advance issues without discarding pre-existing work.
- [x] Write the [final 11-item repair report](purchase-repair-report-2026-11-08.md) and [operator/handoff documentation](purchase-operator-handoff-2026-11-08.md) in `AgentRouterWork/`.

## Verification boundary at report completion — 8 November 2026

The user narrowed the final task to report generation. No further application edits, full test runs, builds, lint runs, browser runs, health checks, or live operations were performed during documentation finalization.

- Last implementation-stage targeted run: 18 passed across write-confirmation and supplier-update/mapping tests.
- [ ] Future acceptance only: rerun full verification and lint on the latest source, retaining the warning count. The earlier full gate predates the final follow-up changes.
- [ ] Future acceptance only: repeat the latest-build browser checks in isolation, preserving existing evidence first.
- [ ] Future acceptance only: real-schema/write and backup/restore checks on the authorized primary/platform with operator safeguards. Synthetic tests are not production acceptance.

These unchecked items describe verification limits for a separately authorized task, not unimplemented repairs among the original 11 findings.
