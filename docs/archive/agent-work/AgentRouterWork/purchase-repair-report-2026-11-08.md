# Kapil Pro purchase repair report — 8 November 2026

All 11 findings from the 7 November purchase audit have repairs and regression evidence in the local worktree; this report records the corrections, verification results, and remaining acceptance limits.

**Audience:** project owner, reviewer, and the next authorized implementation agent.  
**Reader job:** understand what was repaired and what was verified so the owner can decide when to accept the changes.  
**Implementation and browser evidence:** 7 November 2026; report finalized 8 November 2026.  
**Repository:** `/home/arch/project/Kapil_pro`; branch `feat/muse-integration`; HEAD `06de703`.  
**Delivery state:** uncommitted source and documentation changes; no commit, push, deployment, schema migration, or live business transaction was performed by this repair work.

## Outcome and scope

- Corrected supplier opening-credit consumption and ledger/settlement reconciliation for GST bardan, bardan advances, and cancelled bills.
- Made purchase bill, supplier payment, bardan, and bill-edit confirmation resilient to successful writes followed by failed or lost responses.
- Aligned payment modes with the supplied schema, persisted per-line receipt memos, and corrected bardan/credit explanations on chitties.
- Refreshed the purchase audit feed after centralized purchase writes and corrected outgoing-payment, refund, non-cash-credit, and outstanding reporting.
- Repaired the Linux backup script's direct-process lifecycle using synthetic service tests; Windows operator scripts were not changed.
- Fixed related empty-date-range balances, saved-chitty mobile overflow, and a positioning-only sales-table overflow regression.

The existing architecture was retained: financial calculations in `src/domain`, persistence in `src/data`, and workflow orchestration in `src/routes`. Integer paise/grams/milli-rupees and separate Kacha/GST credit pools were preserved. No new library or schema migration was required for these repairs.

**Verification boundary:** the earlier full gate passed with **362 tests passed / 2 skipped**, and the browser evidence contains **28 passing checks**. Two subsequent confirmation regressions and the final snapshot/cancelled-advance corrections were checked with **18 targeted tests passed**. The full suite, typecheck, build, lint, and browser sweep were **not rerun after those last corrections**. This is not a production acceptance certificate.

## All 11 findings: repair matrix

Numbers and original severities follow the [original audit](../docs/operations/audits/purchase-review-2026-11-07.md). “Fixed” below means implemented in source with the stated regression evidence, not tested against the live business database.

| # | Original finding | Correction and current status | Regression evidence |
| --- | --- | --- | --- |
| 1 — High | Opening advances never settle purchase bills | **Fixed:** settlement consumes negative opening credit within its own pool, records `Opening Advance` on affected bill credits, and exposes only unconsumed advance. Entry projections and chitties use the corrected settlement result. | [Financial regressions](../src/domain/supplier-financial-regressions.test.ts): partial, exact, and excess opening credit; Kacha/GST isolation; refund payable offset. [Chitty tests](../src/components/suppliers/bill-chitty.test.tsx): opening-credit reference rendering. |
| 2 — High | Successful supplier payment reported as failed and duplicated | **Fixed:** [confirmed-write boundary](../src/data/confirmed-write.ts) returns committed batch records directly. Lost responses retain the original confirmation identity and reconcile before another send. Applied to bills, payments, bardan, and bill edits; unresolved confirmation blocks blind retries. | [Write-confirmation tests](../src/data/suppliers-write-confirmation.test.ts): failed reads, lost responses, same-entry retries, validation errors, related records, and data-module reload. Browser checks exercised a deliberately lost payment response with one committed payment. |
| 3 — High | GST bardan deductions disagree between ledger and settlement | **Fixed:** ledger bardan deductions use the incremental change in `computeBillNet`, including GST and rounding, rather than subtracting raw base credit. | Financial regressions compare ledger closing with settlement net position for GST, RCM, no-tax, and multiple partial deductions with rounding/order checks. |
| 4 — High | Bardan advance credited twice in the ledger | **Fixed:** the bardan row is informational; its generated `bardan_advance` payment carries the single monetary credit. Payment cancellation removes that credit independently. | Financial regressions include the real bardan-row/payment pair and a cancelled linked payment. Write-confirmation tests check that lost bardan responses do not duplicate the generated payment. |
| 5 — High | Cancelled bill leaves bardan deductions active | **Fixed:** ledger input/domain excludes the monetary effect of bardan belonging to cancelled parent bills. Independently recorded payments retain their own cancellation rules. | Financial regressions assert no ledger entries and zero closing/net position for a cancelled bill with a deduction. |
| 6 — High | BANK mode rejected by supplied PocketBase schema | **Fixed:** centralized `cash`, `upi`, `rtgs`, `neft`, `cheque`, and `other`; removed unsupported BANK selection and validate modes before sending. UPI/RTGS/NEFT/cheque require a reference. No `bank` enum migration was added. | [Mode contract](../src/domain/supplier-payment-modes.ts); write-confirmation test rejects `bank` before a send; browser harness checks supported payment-mode payloads and absence of BANK. Live schema/write acceptance was not performed. |
| 7 — Medium | Chitty invents bardan deductions at 10× value | **Fixed:** removed the monetary fallback for non-deduction methods. Actual deductions appear before the already-netted bill total; in-kind is information, cash-back is a cash memo, and advance is a pool-credit memo with actual applied credit shown separately. | Five added rendered chitty regressions initially failed, then passed: in-kind, cash-back, deduction placement, advance explanation, and opening-credit reference. |
| 8 — Medium | Per-line bags/bardan disappear after saving | **Fixed:** per-line receipt memos persist in versioned private-note metadata keyed by saved line IDs. Create, reload, edit prefill, line removal, and purchase chitty/print mappings preserve them. Uncertain edits recover the committed header/memo snapshot, not a newly reconstructed one. | [Memo tests](../src/domain/purchase-receipt-memos.test.ts), write-confirmation save/reload/edit/removal and uncertain-edit tests, and browser `12 bags` → edit → `14 bags` round trips at both widths. |
| 9 — Medium | Purchase audit feed remains cached after writes | **Fixed:** centralized supplier-purchase invalidation now includes `['purchase-logs-audit']` alongside financial queries. | [Real QueryClient regression](../src/app/purchase-query-invalidation.test.ts) checks audit, bill list, and supplier bundle invalidation. This is not cross-device/live-push synchronization. |
| 10 — Medium | Logs confuse cash direction and omit outstanding components | **Fixed:** shared metrics separate money paid out, refunds received, and non-cash credits. “Amount Owed” comes from settlement summaries, including opening/refund payables; advance is separate. Rows/CSV use explicit direction labels. Overview outgoing totals exclude settle-off and bardan advances. Cancelled payments expose zero available advance. | [Metric tests](../src/domain/purchase-log-metrics.test.ts): all payment classes, opening/refund payables, advances, and cancellation. [Payment mapping regression](../src/data/suppliers-update.test.ts): actual FIFO applied amounts, refund and cancelled-payment advance exclusion. |
| 11 — Medium | Direct-process Linux backup leaves app stopped | **Fixed:** backup stops only PocketBase and leaves Caddy unchanged. Its EXIT trap attempts to resume PocketBase in the original systemd/direct mode on success or failure; an initially stopped database stays stopped. Archiving is refused while port 8090 remains occupied. | [Five synthetic lifecycle tests](../scripts/linux/backup-kapil.test.ts): direct/systemd success and archive failure, plus initially stopped database. Bash syntax and ShellCheck passed during implementation. No real backup/restore acceptance was performed. |

Findings **1–5 predated the existing dirty worktree**; findings **6–11 originated in the earlier uncommitted work**. Repairing them does not make this session the author of the surrounding purchase redesign.

## Financial behavior after repair

| Scenario from the audit | Previous result | Corrected behavior |
| --- | --- | --- |
| ₹50,000 opening advance + ₹80,000 Kacha bill | Bill due ₹80,000; available advance ₹50,000 | Bill due ₹30,000; available advance ₹0; ₹50,000 opening credit shown as applied. |
| ₹1,00,000 base + 18% GST, then ₹10,000 bardan deduction | Ledger ₹1,08,000 versus settlement ₹1,06,200 | Both reflect ₹1,06,200. The event delta includes the tax reduction. |
| ₹1,000 bill + ₹100 bardan advance/payment pair | Ledger ₹800 versus settlement ₹900 | One ₹100 credit: ₹900 net position. |
| Cancelled ₹1,000 bill with ₹100 deduction | Residual −₹100 ledger balance | Cancelled bill and its deduction have zero monetary effect. |
| In-kind bardan: 1 kg at ₹800/kg | False −₹8,000 chitty deduction | Informational in-kind text; no payable reduction. |

Regression fixtures also cover smaller/larger credits, refunds, tax modes, and integer rounding. A date range without transactions now carries the actual balance before the range instead of reverting to the original opening amount.

Receipt memos are **not monetary bardan settlement records**. A value such as `12` prints as `12 bags`; it does not change bill money or automatically convert bags to weight. Previously lost, unpersisted memos cannot be recovered from these fixes.

## Verification record and chronology

Counts below describe separate runs; do not add them together or describe all of them as a fresh final-suite result. Console-only results are recorded in the [work log](work-log-2026-11-07.md); raw terminal logs are not bundled here.

| Stage | Recorded result | Scope and limitation |
| --- | --- | --- |
| Original audit baseline | 318 passed / 2 skipped; typecheck/build passed; lint 0 errors / 59 warnings | Before the repairs. The 59 warnings are a historical baseline, not the final warning count. |
| Financial red/green cycle | New regressions: 10 failed / 3 passed before repair; financial group: 39 passed afterward | Synthetic domain and reconciliation fixtures; no live records. |
| Initial data-boundary group | 25 passed | Confirmed writes plus existing audit/update tests at that stage, before later test additions. |
| Rendered chitty and memo group | 19 passed | Method-specific explanations, opening credits, memo format/legacy compatibility. |
| Linux lifecycle | Initial 2 failed / 3 passed; then 5 passed | Copied backup script, synthetic files, fake service/archive commands. Actual service restart, ZIP restore, retention, and disk-failure acceptance were not established. |
| Shell checks | `bash -n` and ShellCheck passed | Linux scripts only; not PowerShell/Windows validation. |
| Full verification before final follow-ups | `npm run verify` passed: typecheck, 362 tests passed / 2 skipped, production build | Historical full gate. It predates the final confirmation-snapshot and cancelled-advance corrections. |
| Lint before final follow-ups | 0 errors recorded | Final warning count was not retained; no post-follow-up lint result is claimed. |
| Browser after overflow repairs | 28 checks passed; `issues: []`; recorded live database writes: 0 | Built UI with real SDK and intercepted `/pb/api` requests served by an in-memory synthetic API, at 1440 px and 390 px. Predates the final data-layer follow-ups. |
| Last implementation-stage targeted run | 18 passed: 15 write-confirmation tests + 3 supplier-update/mapping tests | Covers pending identity across module reload, committed receipt-memo snapshot recovery after an uncertain edit, and cancelled-payment advance exclusion. Not a replacement for the full gate. |
| Documentation-only finalization | Five Markdown documents checked; 87 local links resolve; 11-item matrix and recorded browser counts agree | Documentation whitespace check passed. No application changes or live operations were resumed to generate this report. |

The earlier audit's local service health checks passed, but this report does not assert current service health. The original temporary reproduction script tested the **buggy baseline**, not corrected behavior; use the current source regression files listed above as repair evidence instead.

### Browser artifacts

- [Verification JSON](browser-verification-2026-11-07.json), timestamp `2026-11-07T13:44:45.163Z`.
- [Rerunnable browser harness](browser-purchase-regression.mjs).
- New bill: [1440 px](screenshots/new-bill-1440.png) / [390 px](screenshots/new-bill-390.png).
- Confirmed payment: [1440 px](screenshots/payment-1440.png) / [390 px](screenshots/payment-390.png).

The checks cover filled new-bill preview, saved chitty, bill/payment/memo round trip, memo edit, lost-payment-response confirmation, purchase bills, suppliers, supplier ledger, purchase logs, print page, overview, and a sales entry screen. There are 14 checks per viewport, not 28 separate business workflows. This was not a physical-device, accessibility-compliance, actual printer, PDF, or JPG-export certification.

## Additional evidenced repairs

These are related corrections discovered while closing the original findings, not a new broad audit:

- **Empty date-range carry:** ledger opening/closing now reflect the prior closing even when the selected range contains no entries.
- **Committed edit snapshots:** retries after uncertain bill edits return private-note metadata from the audit's committed `after_json` header, preserving IDs for newly added receipt lines.
- **Cancelled-payment mapping:** cancelled credits report zero applied amount and zero available advance rather than appearing as unused prepayments.
- **Audit context:** nested bill-edit snapshots and before/after context are resolved for readable audit entries; actor extraction supports the SDK's plain auth record.
- **Read/upload feedback:** affected bill read failures remain visible instead of being treated as “not found” or endless loading; failed photo uploads warn that the financial save already succeeded.
- **Responsive containment:** saved chitty overflow was reduced from 483 px to 390 px document width on a 390 px viewport. A sales-table screen's 889 px overflow was corrected by positioning its scroller; no sales calculations were changed.

## Repair file inventory and attribution

This inventory identifies known repair contributions. It is **not** the whole `git diff` and is not a claim that every line in a listed file was written by this session. Some files were already modified or untracked before these fixes; their complete creation/redesign must not be attributed here. The [previous agent's report](../PURCHASE-MODULE-AUDIT-AND-CHANGES.md) remains separate historical context.

### New repair helpers and regression files

| File | Purpose |
| --- | --- |
| [src/data/confirmed-write.ts](../src/data/confirmed-write.ts) | Shared stable-identity batch confirmation and uncertain-save handling. |
| [src/data/suppliers-write-confirmation.test.ts](../src/data/suppliers-write-confirmation.test.ts) | 15 confirmation, retry, schema-mode, related-record, and memo regressions. |
| [src/domain/supplier-financial-regressions.test.ts](../src/domain/supplier-financial-regressions.test.ts) | 13 opening-credit, tax/bardan, cancellation, and date-window cases. |
| [src/domain/supplier-payment-modes.ts](../src/domain/supplier-payment-modes.ts) | Supported mode/reference contract. |
| [src/domain/purchase-receipt-memos.ts](../src/domain/purchase-receipt-memos.ts) and [tests](../src/domain/purchase-receipt-memos.test.ts) | Versioned line-memo serialization, safe legacy parsing, and print text. |
| [src/domain/purchase-log-metrics.ts](../src/domain/purchase-log-metrics.ts) and [tests](../src/domain/purchase-log-metrics.test.ts) | Financial direction classification and summary aggregation. |
| [src/app/purchase-query-invalidation.test.ts](../src/app/purchase-query-invalidation.test.ts) | Real QueryClient audit-feed invalidation regression. |
| [scripts/linux/backup-kapil.test.ts](../scripts/linux/backup-kapil.test.ts) | Synthetic backup service lifecycle coverage. |

### Repair contributions in existing worktree files

| Area / files | Repair contribution |
| --- | --- |
| [supplier-settlement.ts](../src/domain/supplier-settlement.ts), [settlement tests](../src/domain/supplier-settlement.test.ts) | Opening credit consumption and correct applied-credit rows. |
| [supplier-ledger.ts](../src/domain/supplier-ledger.ts) | Tax-aware bardan deltas, single-counted advance, parent cancellation, and date carry. |
| [supplier-purchases.ts](../src/domain/supplier-purchases.ts) | Hide line-memo metadata from user-facing notes while preserving receipt-weight metadata. |
| [suppliers.ts](../src/data/suppliers.ts), [audit tests](../src/data/suppliers-audit.test.ts), [update tests](../src/data/suppliers-update.test.ts) | Confirmed writes, stable memo mapping/recovery, cancelled-advance exclusion, and audit context. |
| [query-invalidation.ts](../src/app/query-invalidation.ts) | Include purchase audit feed in shared invalidation. |
| [bill-chitty.tsx](../src/components/suppliers/bill-chitty.tsx), [chitty tests](../src/components/suppliers/bill-chitty.test.tsx) | Correct bardan/credit explanations and contain mobile table overflow. |
| [bill-modals.tsx](../src/components/suppliers/bill-modals.tsx) | Apply shared supported-mode/reference rules to affected payment entry. |
| [new-purchase-bill.tsx](../src/routes/new-purchase-bill.tsx), [new-supplier-payment.tsx](../src/routes/new-supplier-payment.tsx) | Entry/edit memo payloads and prefill, corrected credit projection, supported modes, and save feedback. |
| [purchase-bills/index.tsx](../src/routes/purchase-bills/index.tsx), [purchase-bills/$billId.tsx](../src/routes/purchase-bills/$billId.tsx), [print-purchase-bills.tsx](../src/routes/print-purchase-bills.tsx) | Receipt memo and applied-credit display mappings; affected read/action feedback. |
| [purchase-logs.tsx](../src/routes/purchase-logs.tsx), [purchase-dashboard.tsx](../src/routes/purchase-dashboard.tsx) | Correct financial labels, rows/export direction, settlement summaries, and outgoing totals. These routes already existed in the uncommitted work. |
| [new-bill.tsx](../src/routes/new-bill.tsx) | Position-only sales table scroller containment; not a sales-domain change. |
| [backup-kapil.sh](../scripts/linux/backup-kapil.sh), [common.sh](../scripts/linux/common.sh), [start-kapil.sh](../scripts/linux/start-kapil.sh) | Linux lifecycle repair and reusable direct-process startup helpers within the pre-existing untracked script set. |

### Documentation and evidence delivered

All requested repair documentation is under `AgentRouterWork/`: this report, [operator/handoff notes](purchase-operator-handoff-2026-11-08.md), [README](README.md), [implementation plan](purchase-fixes-plan-2026-11-07.md), [work log](work-log-2026-11-07.md), browser harness, verification JSON, and four screenshots. The original audit remains at `docs/operations/audits/purchase-review-2026-11-07.md` as the pre-repair reference.

Package/lockfile edits, shared UI/layout changes, item/casting work, route-tree changes, Windows/Caddy configuration, and other existing worktree additions must be reviewed separately. They were not discarded or automatically claimed as purchase-repair work. No runtime data, credential, database, executable, or backup contents are included in this report.

## Acceptance limits and next authorized checks

The requested report is complete. No further application changes are implied by the following handoff items:

1. **Fresh final gate:** rerun full verification and lint on the latest source; capture the actual warning count. The recorded 362-pass result predates the final fixes.
2. **Final browser confirmation:** repeat saved-memo/edit/retry and cancelled-payment checks on the latest build in an isolated environment. Preserve the existing evidence before a rerun; the harness overwrites its dated JSON and screenshot files.
3. **Production authority:** project instructions designate the Windows PC as the sole writable primary, while this inspected checkout is the Linux `feat/muse-integration` worktree. These repairs did not change that authority or authorize a second writable database. Read the [Windows setup](../WINDOWS-SETUP.md), [database runbook](../DATABASE-RUNBOOK.md), and [troubleshooting](../TROUBLESHOOTING.md) before future runtime/database operations.
4. **Operator acceptance:** use the correct platform's safeguards for any later real-schema/write or backup/restore acceptance. The five Linux tests do not prove real-process restart, archive recoverability, or Windows behavior.
5. **Review and version control:** review the mixed dirty worktree and intentionally select changes before any separately authorized commit. No blanket staging, reset, or rollback is part of this delivery.

Line/branch coverage, exhaustive concurrency/cross-device idempotency, all sales/export workflows, and production acceptance were not measured. A supported local pending identity reduces uncertain-save duplicates; it is not a server-wide uniqueness rule for all browsers or devices.

The optional community lookup was unavailable during implementation. This report uses local source, test evidence, and the recorded work log; it does not introduce unverified community claims.
