# Operate and review the repaired purchase flows

These notes explain how to handle uncertain saves and interpret repaired purchase records without creating duplicate transactions or mistaking receipt memos for financial credits.

**Audience:** purchase operator and next authorized developer.  
**Reader job:** recognize the saved state and financial meaning of a purchase so they can continue safely or escalate an unresolved result.  
**Scope:** guidance for the uncommitted repairs summarized in the [repair report](purchase-repair-report-2026-11-08.md); not deployment approval.

## Prerequisites and authority

- Follow the project's [AGENTS.md](../AGENTS.md), [Windows setup](../WINDOWS-SETUP.md), [database runbook](../DATABASE-RUNBOOK.md), and [troubleshooting](../TROUBLESHOOTING.md).
- The project instructions designate `runtime/data/data.db` on the Windows PC as the **only writable primary**. A Linux source checkout is not permission to create or operate a second writable business database.
- Keep PocketBase at `127.0.0.1:8090` and Caddy at `127.0.0.1:4174`. Do not expose either listener or copy/edit an active SQLite database.
- The earlier 362-pass full gate and 28-check browser run predate the final data-layer corrections. The last targeted run passed 18 tests; a fresh final gate remains a future acceptance step.

## Handle an uncertain bill, payment, bardan, or edit save

### 1. Preserve the original entry and context

If the message says the save “could not be confirmed,” retain the same browser profile, site URL, signed-in account, and entry values. Note the supplier, date, pool, amount, reference, and bill number before navigating away.

**Expected result:** the original pending confirmation identity remains available. Do not clear browser storage, switch devices, change the values, or submit a second entry to bypass the warning.

### 2. Inspect the existing record/history

Check the purchase bill list, the supplier payment history, or the affected bill/bardan detail. Restore normal connectivity/sign-in if reads are failing.

**Expected result:** either the committed entry is visible, or the save is still unresolved. A failed list read is not proof that nothing was saved; do not create a replacement record on that assumption.

### 3. Retry the same entry to confirm its original save

With connectivity restored, retry the unchanged entry in the same context. The confirmation boundary checks the original identity before sending a new batch.

**Expected result:** an existing confirmed record is returned without another transaction. If confirmation still cannot be read, another send remains blocked. If the original identity is definitively absent, the unchanged operation can reuse that identity. A changed input may produce a conflict requiring review of the original save first.

### 4. Check the financial result once confirmation succeeds

Compare the bill detail, supplier ledger, and purchase logs. For bill-day payment, verify the bill and its payment/allocation are present once.

**Expected result:** one intended business transaction, with updated bill credits/due and history. If duplicate records are discovered, stop and have an authorized operator inspect and correct them using normal cancellation rules; do not delete them directly from SQLite.

### Distinguish other outcomes

| Message/state | Meaning | Safe next action |
| --- | --- | --- |
| Confirmed/saved record returned | Financial batch succeeded; no extra confirmation read is required for a normal successful response. | Review the saved record rather than saving it again. |
| Definitive validation error | The transaction was rejected, rather than left uncertain. | Correct the reported field and submit through the normal form. |
| Save confirmed, photos failed to upload | Financial records succeeded; photo upload is separate follow-up work. | Re-add the photos to the existing record, not the bill/payment itself. |
| Unable to load bill/history | Read failure is visible instead of being interpreted as an empty result. | Restore connectivity/authentication and reload; do not create replacements. |

Pending-save storage contains a record ID, input fingerprint, and label, scoped to the API/user/operation. It does **not** store the entire form for recovery. With browser storage unavailable, the memory fallback only protects the current page session. Cross-profile/device deduplication and deliberately repeating a confirmed transaction are not prevented by a server-wide idempotency rule.

## Enter supported payment modes

| Mode | Reference required |
| --- | --- |
| Cash | No |
| UPI | Yes |
| RTGS | Yes |
| NEFT | Yes |
| Cheque | Yes |
| Other | No |

Use the actual transfer method instead of BANK. The supplied schema does not accept `bank`, and the repaired data boundary rejects it before sending. Do not alter the schema to bypass a stale UI or invent a reference for an actual transaction.

## Record bags and receipt memos

1. Enter the per-material receipt memo in the bags/bardan field. A numeric `12` is presented as `12 bags`; descriptive text is retained as a memo.
2. Save and reopen the bill. **Expected:** the saved chitty contains the memo, not only the live preview.
3. Edit the bill through the normal UI. **Expected:** existing memos prefill, changed memos survive save/reload, and removed lines no longer leave orphan memo entries.

Receipt memos do not change bill amount, taxable base, payments, or bardan settlement. Keep them distinct from the existing receipt-weight metadata and from later monetary bardan entries.

### Developer storage contract

- Memos are encoded in `private_note` using `[purchase_line_memos_v1:…]`, mapping **persisted line IDs** to memo text.
- [purchase-receipt-memos.ts](../src/domain/purchase-receipt-memos.ts) owns parsing/formatting. [supplier-purchases.ts](../src/domain/supplier-purchases.ts) hides the metadata from user-facing notes and retains existing receipt-weight tags.
- [suppliers.ts](../src/data/suppliers.ts) supplies the memo on detail, bundle, list, and edit paths. Chitty/print routes render `receiptMemo` using the shared text helper.
- Preserve stable line IDs while editing. Uncertain-edit confirmation uses the committed audit snapshot so newly generated line IDs and their memo metadata remain consistent.
- Do not strip unknown metadata by manually rewriting private notes or save edited bills with an older client that omits these memos.
- Legacy bills without metadata open normally; malformed metadata does not prevent reading a bill. Memos previously lost before persistence cannot be reconstructed automatically.

## Interpret the repaired financial labels

| Label / event | Meaning |
| --- | --- |
| Bill Net Amount | Includes the domain's adjustments, actual bardan deduction, tax, and rounding. Do not subtract an already-included deduction a second time. |
| Payments & Credits Applied / Paid so far | Applied settlement credits, including opening advance. It is not necessarily money paid in cash on this bill date. |
| Balance Due / Still to pay | Remaining amount payable on that bill after actual applied credits. |
| Amount Owed | Outstanding supplier payables from settlement, including unpaid openings and refund payables; not only bill dues. |
| Available advance | Unconsumed credit, still constrained by Kacha/GST pool. A cancelled payment contributes no available advance. |
| Net position | Amount owed minus available advance as a reporting measure; not permission to apply one pool's credit to another. |
| Total Paid Out | Monetary outgoing `payment` and `paid_on_behalf` activity, including bank-transfer modes; not incoming refunds or non-cash credits. |
| Refunds received | Incoming money; not paid-out spending or an ordinary advance payment. |
| Non-cash credits | `settle_off` and `bardan_advance`; not cash spending. |

The purchase-log summary cards currently use the full loaded active dataset, not the filtered transaction rows. Its CSV exports the selected/filtered rows with an explicit direction column. Compare totals only when scope, cancellation state, supplier, date, and pool match.

### Interpret bardan methods

| Method | Financial effect | Chitty explanation |
| --- | --- | --- |
| `deduct` | Recorded deduction affects bill net; a GST bill's ledger event includes the tax/rounding delta. | “Less: Bardan,” before Bill Net Amount; marked as included in bill net. |
| `in_kind` | No payable deduction. | “Settled in kind” information. |
| `cash_back` | Cash memo does not itself reduce the bill payable. | “Cash memo” using the recorded cash amount. |
| `advance` | Generated supplier credit payment carries the single financial effect; the bardan row does not credit the ledger again. | “Pool credit” memo; the amount actually applied appears in settlement credit rows. |

Cancelling a parent bill removes that bill and its monetary deductions from the ledger. Independently recorded payments keep their own cancellation status; cancelling a bill is not an automatic reversal of every related payment.

## Understand backup behavior without running live operations

No business backup, restore, migration, or service lifecycle operation was run to finalize this report. The following commands are reference-only operator instructions, not newly verified production commands.

### Windows primary: use the existing runbook

From the authorized Windows installation, before separately approved database-affecting work:

```powershell
.\windows\health-check.ps1
.\windows\backup-kapil.ps1
```

**Expected according to the existing runbook:** a stopped-database archive under `runtime\backups` with a SHA-256 sidecar. Use the [database runbook](../DATABASE-RUNBOOK.md) for verification, external copies, restore, and failed-restore preservation. Windows scripts were not changed or exercised by these Linux repair tests.

### Linux script: repaired lifecycle, synthetic verification only

For a separately authorized Linux test installation, the existing commands are:

```bash
bash scripts/linux/health-check.sh
bash scripts/linux/backup-kapil.sh
```

These are **not** instructions to make this Arch checkout a second writable primary. The repaired Linux script behaves as follows:

| Initial state | Backup action | On normal exit or handled failure |
| --- | --- | --- |
| PocketBase managed by active `kapil-pb.service` | Stop that user service; verify it is inactive and port 8090 is free. | Attempt to restart the same user service. |
| PocketBase running through the direct-process helper | Stop PocketBase only; verify port 8090 is free. | Attempt direct-process PocketBase startup. |
| PocketBase initially stopped | Leave it stopped; refuse archiving if another listener occupies 8090. | Leave it stopped. |
| Caddy, running or stopped | No Caddy stop/start operation. | Initial Caddy state is unchanged. |

**Expected on successful Linux backup:** a `kapil-local-<timestamp>.zip` and `.sha256.txt` under `runtime/backups`, successful operations-log entries, and PocketBase resumed in its original launch mode when it was running. Caddy may continue serving the site while database requests are temporarily unavailable.

**If it fails:** a nonzero result must not be treated as a verified backup. Check the operations log, available disk space, service state, and archive/hash validity using the appropriate platform runbook. Do not restore a failed or unexpectedly small archive, repeatedly launch duplicate processes, or bypass the stopped-database guard.

The EXIT trap attempts restoration; it cannot guarantee recovery after SIGKILL, power loss, or failed restart. The five tests stub service and archive commands. They do not establish real-process health, listener-blocked/restart-failure branches, retention correctness, full ZIP integrity, or restore recoverability.

## Handoff for the next authorized session

### Goal of next session

Only if requested, close the verification/acceptance limits in the [repair report](purchase-repair-report-2026-11-08.md). The current request was report-only; do not restart broad auditing or make more application changes by default.

### State of play

All 11 audited findings have source repairs and recorded regressions. The mixed worktree remains uncommitted on `feat/muse-integration`, HEAD `06de703`. Nothing was pushed or deployed; no business records or runtime data were used as test fixtures. There is no blocker to reading/delivering the report.

### Open decisions and checks

- Determine the authorized runtime/platform before any real operation; do not infer primary database authority from local service availability.
- Run a fresh full gate, lint, and latest-build browser check before claiming final all-green acceptance.
- Select repair and pre-existing work intentionally for a separately authorized commit. Never stage the entire dirty worktree or reset someone else's edits.

### Skills to use

Use the smallest relevant set: `using-superpowers` for workflow routing; `test` for verification; `agent-browser`/`browser-testing-with-devtools` for authorized browser checks; `docs` for updating evidence. Use a commit skill only after an explicit commit request. No delegated agent work is required to deliver these documents.

### Artifacts and recorded commands

- [Repair matrix, inventory, and verification limits](purchase-repair-report-2026-11-08.md).
- [Original audit](../docs/operations/audits/purchase-review-2026-11-07.md), [implementation plan](purchase-fixes-plan-2026-11-07.md), and [work log](work-log-2026-11-07.md).
- [Browser JSON](browser-verification-2026-11-07.json), [harness](browser-purchase-regression.mjs), and [screenshots](screenshots/).

The last implementation-stage targeted command was:

```bash
npx --no-install vitest run src/data/suppliers-write-confirmation.test.ts src/data/suppliers-update.test.ts
```

**Recorded result:** 18 tests passed; not rerun during report finalization. The project's broader verification commands are `npm run verify` and `npm run lint`; their earlier results are in the report.

The browser harness requires installed Playwright, an available Chromium executable (`CHROME_PATH` override), and an isolated built UI at `KAPIL_TEST_URL` (default `http://127.0.0.1:4174`) using the expected same-origin `/pb` API path. Its interception is not a general safety guarantee for different API URLs. Do not run it against the writable business instance to repeat this report. Preserve its existing dated JSON/screenshots before rerunning because the script overwrites them.
