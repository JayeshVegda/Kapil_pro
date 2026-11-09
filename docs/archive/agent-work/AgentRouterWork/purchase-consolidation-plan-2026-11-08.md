# Purchase Workflow Consolidation Implementation Plan

> **Execution:** Use `executing-plans`, `refactor`, and `test-driven-development` inline, with independently verified slices. Keep all work uncommitted on `feat/muse-integration`; do not dispatch subagents or perform browser verification.

**Goal:** Share purchase/supplier reads, financial orchestration, query definitions, dialogs, and bill presentation without redesigning the completed purchase interface.

**Architecture:** Map each purchase collection once into a shared read model, run the existing pool-separated settlement once per supplier, and expose typed query projections of that snapshot. Keep pure calculations in `src/domain`, PocketBase access in `src/data`, and UI orchestration in routes/components. Preserve legacy loader exports and protected writes.

**Tech Stack:** Existing React 19, TypeScript, TanStack Query v5, PocketBase, Radix dialog primitives, and Vitest; no added dependencies.

## Global Constraints

- Preserve the approved calm slate/blue UI and all pre-existing uncommitted work.
- Continue and finish autonomously without further questions.
- Continue skipping browser verification.
- Leave everything uncommitted on `feat/muse-integration`; no commits or pushes.
- No database operations, schema migrations, runtime configuration changes, or new services.
- Preserve money in integer paise, weights in grams, and rates in milli-rupees.
- Preserve financial ordering: business date, created timestamp, record id.
- Preserve Kacha/GST isolation, opening balances/credits, cancellation, receipt memos, and confirmed-write recovery.
- Verify each slice with focused tests and typecheck; finish with `npm run verify`, `npm run lint`, and `git diff --check`.

## Characterized Contracts

- `loadSupplierBundle(id): Promise<SupplierBundle>` first resolves the supplier, then reads six collections; includes cancelled records and filters allocations by the supplier's payment ids, not by bill ids.
- `loadSuppliersSummary(): Promise<SupplierSummary[]>` includes inactive suppliers and orders them by company name. `outstandingPaise` is **net position**, pool dues are payables, and `advancePaise` is separate. Last activity includes cancelled records and bardan dates; aging excludes cancelled/NIL bills.
- `loadAllPurchaseBills(): Promise<EnrichedPurchaseBill[]>` returns newest first, keeps cancelled rows, enriches receipt memos, and uses settlement-derived nets/dues/status. Orphaned suppliers retain the existing `Unknown Supplier`/zero-settlement fallback.
- `loadAllSupplierPayments(): Promise<EnrichedSupplierPayment[]>` returns newest first, computes applied credit against full bill inputs, excludes cancelled/refund payments from advance, and displays stored manual allocations even if they no longer apply.
- Loaders are read-only. Failures propagate through their existing `runDataOperation` labels; no swallowed collection errors or success-shaped empty fallback.
- The shared query cache is memory-only under a new purchase key; persisted dashboard/master shapes stay unchanged.
- Payment entry currently simulates selected bills' full dues but persists only the amounts actually applied to those selected bills. Preserve this distinction and test chronology, partial pins, refunds, and pool separation.
- Dashboard payable tiles intentionally use positive supplier **net positions**, while bill aging uses bill dues. Preserve casting total fallbacks, grade aliases, latest-rate tie behavior, month fallback, and outgoing-payment classification.
- Preserve each bill/chitty caller's receipt-memo choice, tax metadata, raw private note, opening-advance credits, and payment order. Source inspection confirmed all three existing chitty routes keep item names unchanged and show formatted receipt memos in the bardan column.
- The quick-payment modal currently labels all money beyond supplied pins as advance; separately correct the preview to account for other same-pool/opening/refund dues after characterizing it.
- The cancellation preview currently omits bardan; separately correct it to use the tax-aware bill net including deductions after a failing regression test.

## Task 1: Shared Read Model and Settlement Adapters

**Files:** `src/domain/supplier-bundle.ts`, `src/domain/purchase-read-model.ts`, `src/data/suppliers.ts`, `src/data/purchase-read-model.test.ts`, `src/test/purchase-fixtures.ts`.

**Interfaces:** `PurchaseCollections` contains bills, lines, adjustments, bardan, payments, allocations. `SupplierPurchaseContext` contains `bundle: SupplierBundle` and `settlement: SupplierSettlementResult`. `PurchaseReadModel` exposes `suppliers`, `summaries`, `bills`, `payments`, and `supplierContexts`. `buildPurchaseReadModel(suppliers, collections, today?)` is pure; `loadPurchaseReadModel()` performs one seven-collection read. Legacy exports retain their signatures.

- [x] Characterize supplier filtering, financial values, cancelled/unknown records, memo enrichment, ordering, and read failures against the current loaders.
- [x] Run `npx --no-install vitest run src/data/purchase-read-model.test.ts` and confirm characterization passes before extraction.
- [x] Add the single-snapshot test before implementing the new loader:
  ```ts
  const model = await loadPurchaseReadModel()
  expect(model.bills).toEqual(await loadAllPurchaseBills())
  expect(model.payments).toEqual(await loadAllSupplierPayments())
  ```
- [x] Extract pure bundle adapters, grouped collection projections, and enrichment; delegate existing loaders without changing protected writes.
- [x] Run focused data and financial regressions, then `npm run typecheck`.

**Task 1 verification:** Eight characterization tests passed against the original loaders; the new snapshot test first failed with `TypeError: loadPurchaseReadModel is not a function`. After extraction, six focused files / 56 tests and `npm run typecheck` passed.

## Task 2: Typed Shared Queries and One Refresh Boundary

**Files:** `src/data/purchase-queries.ts`, `src/data/purchase-queries.test.ts`, `src/app/query-invalidation.ts`, `src/app/purchase-query-invalidation.test.ts`, purchase/supplier routes and consumers under `src/components/suppliers/`.

**Interfaces:** `purchaseReadModelQueryOptions()`, `purchaseBillsQueryOptions()`, `supplierPaymentsQueryOptions()`, `suppliersSummaryQueryOptions()`, `supplierContextQueryOptions(id)`, `supplierBundleQueryOptions(id)`, `purchaseBillQueryOptions(id)`, `supplierListQueryOptions()`, and `purchaseAuditQueryOptions()` own keys/functions/enabled states. Financial projections share `['purchase-read-model']`; isolated bill detail keeps `['purchase-bill', id]`.

- [x] Add query tests proving projections share one snapshot, missing suppliers return `null`, disabled contexts do not fetch, and writes invalidate the shared snapshot.
  ```ts
  expect(purchaseBillsQueryOptions().queryKey).toEqual(supplierPaymentsQueryOptions().queryKey)
  expect(supplierContextQueryOptions('').enabled).toBe(false)
  ```
- [x] Run focused tests to observe missing options/refresh behavior fail.
- [x] Implement options and migrate dashboard, logs, supplier master/detail, payment entry, bill lists/printing/drawer, and existing purchase-bill consumers.
- [x] Invalidate the shared snapshot once after confirmed writes; retain legacy-key invalidation for compatibility and the lightweight badge. Remove duplicate invalidation, explicit refetch after mutations, and refresh-on-dismissal.
- [x] Run query/invalidation/data tests and `npm run typecheck`.

**Task 2 verification:** Query tests first failed on the missing options module; both shared-snapshot invalidation regressions also failed before implementation. After migration, five focused files / 33 tests and `npm run typecheck` passed. Financial query consumers share one memory-only snapshot; persisted provider configuration is unchanged.

## Task 3: Domain-Owned Dashboard Aggregation

**Files:** `src/domain/purchase-dashboard.ts`, `src/domain/purchase-dashboard.test.ts`, `src/routes/purchase-dashboard.tsx`, dashboard presentation types as needed.

**Interfaces:** `buildPurchaseDashboard({ bills, payments, summaries, castingSessions, today })` returns `snapshot`, `gradeRows`, `cadenceRows`, `materialTotals`, `payNext`, `recentBills`, `recentPayments`, `todayProcurement`, and `todayPaid`.

- [x] Add failing tests for net-position KPI meaning, aging edges, cancellation/outgoing-payment exclusions, material aliases, month fallback, equal-date rates, and casting fallbacks.
  ```ts
  expect(result.snapshot.totalWeOwePaise).toBe(positiveSupplierNetPositions)
  expect(result.snapshot.totalPaidPaise).toBe(outgoingPaymentPaise)
  ```
- [x] Extract the current calculations unchanged into the pure builder; leave approved presentation components/layout untouched.
- [x] Add an explicit load-error state rather than displaying failure as zero-valued financial data.
- [x] Run dashboard/log-metric tests and `npm run typecheck`.

**Task 3 verification:** Dashboard contract tests first failed on the missing builder module; the rendered read-error regression then failed because zero-valued financial panels were still displayed. After extraction, dashboard/domain/log-metric/read-state tests passed (three files / 11 tests), followed by `npm run typecheck`. Route tests use server rendering that waits for route code splitting; no browser or runtime configuration changes were needed.

## Task 4: Shared Payment Preparation

**Files:** `src/domain/supplier-payment-workflow.ts`, `src/domain/supplier-payment-workflow.test.ts`, `src/routes/new-supplier-payment.tsx`.

**Interfaces:** `buildSupplierPaymentWorkflow(context, proposal)` returns ordered open bills, allocation preview, coverage, selected totals, and recent payments. `prepareSupplierPaymentInput(draft, workflow)` validates existing form rules and constructs the unchanged `SupplierPaymentCreateInput` payload.

- [x] Add failing tests for partial selected pins, FIFO leftovers, opening/refund dues, backdated payments, zero input, pool isolation, reference/payee validation, and trimmed payloads.
  ```ts
  expect(payload.allocations).toEqual([{ billId: 'selected', amountPaise: actuallyAppliedPaise }])
  expect(refundPayload.allocations).toBeUndefined()
  ```
- [x] Extract workflow and payload preparation without changing `previewSupplierPayment` or write confirmation.
- [x] Reuse cached supplier settlement rather than recomputing it across route memos; disable saving when the financial context is unavailable.
- [x] Run workflow/domain/write tests and `npm run typecheck`.

**Task 4 verification:** Workflow tests first failed on the missing module; three rendered route-state tests then failed because unavailable supplier data appeared as empty finances. After extraction and route adoption, seven focused workflow/read-state/settlement/financial/protected-write files / 76 tests and `npm run typecheck` passed. Full-due simulation and actually-applied persisted pins remain separate; the confirmed payment's supplier id determines refresh.

## Task 5: Shared Chitty Presentation

**Files:** `src/components/suppliers/purchase-bill-presentation.ts`, `src/components/suppliers/purchase-bill-presentation.test.ts`, `src/routes/purchase-bills/index.tsx`, `src/routes/purchase-bills/$billId.tsx`, `src/routes/print-purchase-bills.tsx`, `src/routes/supplier-ledger.$supplierId.tsx`.

**Interfaces:** `buildPurchaseBillPresentation(detail, context, { receiptMemosInItemName? })` returns chitty data, payment rows, and the matching settlement row. Supplier detail reuses shared enriched payment projections.

- [x] Add failing presentation tests for tax/bardan metadata, hidden note parsing, receipt-memo caller variants, opening-advance rows, and payment chronology.
  ```ts
   expect(presentation.privateNote).toBe(detail.bill.privateNote)
   expect(presentation.chitty).not.toHaveProperty('privateNote')
  expect(presentation.paymentRows[0].reference).toBe('Opening Advance')
  ```
- [x] Replace three duplicated bill/chitty mappings and supplier-detail payment enrichment, preserving caller-specific item text and premium columns.
- [x] Run presentation/chitty/receipt tests and `npm run typecheck`.

**Task 5 verification:** Presentation tests first failed on the missing builder module. Five focused presentation/chitty/receipt/read-model/query files / 42 tests and `npm run typecheck` passed after extraction. The existing opening-advance row deliberately has a blank date, and fallback allocations retain read order. Raw/parsed private notes stay outside `BillChittyData` (which has no private-note field), with a rendered test proving hidden metadata and internal notes do not print. Supplier detail filters the existing cached enriched-payment projection and keeps its chronological table input; it performs no extra data read or settlement.

## Task 6: Existing Dialog Primitives and Isolated Preview Corrections

**Files:** `src/components/suppliers/purchase-dialog.tsx`, `src/components/suppliers/bill-modals.tsx`, `src/domain/supplier-payment-workflow.ts`, workflow/presentation/dialog-state regression tests.

**Interfaces:** `PurchaseDialog` uses existing `Dialog`, `DialogContent`, `DialogTitle`, and `DialogFooter` while preserving Ctrl/Cmd+Enter submission and the current form styling. Pure read-state helpers distinguish loading, error, not-found, and ready records.

- [x] Replace the handwritten overlay/shell with the existing portal/focus-trapping primitive, preserving labels, actions, colors, compact form contents, and close semantics.
- [x] Cover explicit loading/error/not-found states; prevent submitting when required records are unavailable.
- [x] Write a failing quick-payment regression showing remaining money pays other same-pool dues before becoming advance, then correct only that preview.
- [x] Write a failing cancellation regression using GST plus bardan deduction, then compute the displayed net with all bill inputs.
- [x] Run all focused new tests plus existing purchase regressions, then `npm run typecheck`.

**Task 6 verification:** Dialog/read-state guards passed 39 tests before preview work. Quick-payment workflow adoption was characterized separately (caller pin order, partial pins, and cached dues), then 44 focused tests and typecheck passed. The two payment-remainder regressions failed before correction, passed after subtracting all this payment's applied dues, and failed again when only that correction was removed; the existing-standing-advance characterization stayed green. Three cancellation regressions (GST, RCM, and untaxed, with deductions, a cash-back memo, adjustments, and rounding) similarly passed red–green–red when only the bardan input was changed. After restoring both fixes, 13 focused dialog/workflow/financial/read/query/protected-write files / 147 tests and `npm run typecheck` passed. Tests run in Node with query/write and portal boundaries stubbed; browser focus, stacking, and visual behavior remain deliberately unverified.

## Completion Gate

- [x] Run `npm run verify` (typecheck, full Vitest suite, production build).
- [x] Run `npm run lint`; report any pre-existing repo-wide violations rather than weakening rules or deleting tests.
- [x] Run `git diff --check` and inspect final status/diff for unrelated edits.
- [x] Review the changed source for financial, loading, identity, and refresh regressions.
- [x] Record exact implemented scope, commands/results, skipped browser checks, community-auth limitation, and uncommitted branch state in `AgentRouterWork/purchase-consolidation-report-2026-11-08.md`.

**Completion verification:** The fresh full run (test phase started at 22:36:13) passed typecheck, 66 test files / 463 tests, and production build; two existing emit suites remained skipped. Lint passed with 0 errors / 46 existing warnings (59 at baseline; no new warning messages). `git diff --check` passed, and consolidation-only review found no new blocking issue. The report records the 41 TypeScript differences, verification limits, and unchanged uncommitted branch/HEAD state.

## Research and Deliberate Exclusions

- Official TanStack Query documentation confirms `queryOptions` key/function reuse and that awaited invalidation refetches active observers by default: https://github.com/tanstack/query/blob/main/docs/framework/react/guides/query-options.md.
- DevRelay community search remains unavailable without MLH authentication; the previous sign-in timed out. Do not invent community sources or delay the local implementation on external authentication.
- The user's permanent no-MLH-connection rule is saved in `/home/arch/AGENTS.md`; do not reconnect, retry sign-in, or open an MLH authentication browser.
- No app-wide query overhaul, sales-accounting engine, database/backend changes, new dependencies, visual redesign, commits, pushes, or additional browser checks.
