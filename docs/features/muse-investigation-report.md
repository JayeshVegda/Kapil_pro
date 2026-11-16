# Muse AI & System Architecture Investigation Report

> **Status:** READ-ONLY Verification Report
> **Date:** 15 November 2026
> **Repository:** `Kapil_pro` (`feat/muse-integration`)
> **Companion Plan:** [docs/features/muse-purchase-casting-drafts-plan.md](muse-purchase-casting-drafts-plan.md)
> **Scope:** Facts verified directly in code and migrations. Anything unverified is marked "UNVERIFIED". No secrets, passwords, or tokens printed.

---

## 1. Project

* **Stack:** React 19, TanStack Router (file-based), TanStack Query v5, Tailwind CSS v4, Vite, PocketBase (SQLite with WAL mode).
* **Modules:**
  * **Sales Billing:** Outbound GST/estimate invoices for brass hardware, customer ledgers, collections, physical bill books (50 bills/book), market rates (`brass_rates`).
  * **Purchase / Procurement:** Inward scrap brass intake, supplier khata, weight deductions, gunny bag (bardan) tracking, 5 outward payment kinds.
  * **Casting & Melting:** Foundry melting sessions, ordered heats/batches, metal input logs, loaded cost/kg calculation (coal, labor, metal), wire output and melting loss (mel).
* **Data Model per Module:**
  * **Sales:** `customers`, `items`, `bills`, `bill_items`, `payments`, `brass_rates`. Drafts: `bill_drafts`, `bill_draft_items`, `bill_draft_payments`, `payment_drafts`.
  * **Purchase:** `suppliers`, `purchase_items`, `purchase_bills`, `purchase_bill_lines`, `purchase_bill_adjustments`, `purchase_bardan`, `supplier_payments`, `supplier_payment_allocations`, `purchase_audit_log`.
  * **Casting:** `casting_materials`, `casting_sessions`, `casting_batches`, `casting_batch_inputs`.
  * **Settings & Core:** `app_settings` (`globalsettings1`), `saved_views`, `users`.
* **Money & Weight Units:**
  * **Sales:** Floating-point Rupees (`rate`, `subtotal`, `grand_total`, `gst_amount`, half-up rounding). Decimal kg.
  * **Purchase:** Strict integers only: `weight_g` (integer grams, 1 kg = 1,000 g), `rate_milli` (integer milli-rupees/kg, ₹450.50 = 450,500), `amount_paise` (integer paise, ₹1.00 = 100 paise). Float conversion is banned.
  * **Casting:** Decimal kg for metal/coal inputs, wire output, mel. Decimal Rupees for worker wage, coal rate, and loaded cost/kg.
* **Pools (`kacha` & `gst`):**
  * Purchase operates dual isolated accounting pools. Balances, payments, and FIFO bill clearing never cross pools. Manual payment allocations must strictly match the payment's pool.
* **Routes List (41 routes):**
  * Core: `/`, `/drafts`, `/ledger`, `/transactions`, `/calendar`, `/settings`, `/backup`, `/data-health`, `/issues`, `/control-room`, `/dev/components`.
  * Sales: `/new-bill`, `/new-payment`, `/print-bill`, `/sales-dashboard`, `/customers`, `/items`, `/monthly-sales-calendar`, `/reports/sales`.
  * Purchase: `/new-purchase-bill`, `/new-supplier-payment`, `/purchase-bills`, `/purchase-bills/$billId`, `/print-purchase-bills`, `/supplier-payments`, `/suppliers`, `/purchase-items`, `/supplier-ledger.$supplierId`, `/bardan-pending`, `/purchase-logs`, `/purchase-dashboard`, `/reports/purchase`.
  * Casting: `/casting`, `/casting/new-session`, `/casting/log`, `/casting/bill`, `/casting/materials`, `/reports/casting`.
  * Reports: `/monthly-report`, `/company-report`, `/module-report`, `/export-reports`.

---

## 2. Muse Today

* **What Muse Is:** An external AI voice/text parsing agent that parses dictations, WhatsApp messages, or slips into structured accounting proposals.
* **Authentication:** PocketBase email/password auth against `users` collection (`identity: "muse@kapil.cosearch.me"`, password present in `runtime/state/muse-credentials.json`). Token sent as `Authorization: Bearer <JWT>`.
* **What Muse Can Create:** Sales bill draft headers (`bill_drafts`), line items (`bill_draft_items`), bill payments (`bill_draft_payments`), and standalone receipt drafts (`payment_drafts`).
* **Collections It Touches:**
  * Reads: `customers`, `items`, `brass_rates`, `bill_drafts`, `payment_drafts` (for duplicate checks).
  * Writes: `bill_drafts`, `bill_draft_items`, `bill_draft_payments`, `payment_drafts`.
* **How Dictation Becomes a Draft:**
  1. Dictation with bill items $\rightarrow$ Muse creates 1 `bill_drafts` record, then $N$ `bill_draft_items`, plus optional `bill_draft_payments` (or sends all in 1 `POST /api/batch`).
  2. Dictation of money only (no bill items) $\rightarrow$ Muse creates 1 `payment_drafts` record with `raw_text`, customer name/ID, amount, mode (`Cash`/`Bank`), note, and `status: "pending_review"`.
* **How Owner Reviews in AI Drafts (`/drafts`):**
  * Navigates to `/drafts` (`src/routes/drafts.tsx`). Table lists combined pending bills and payments.
  * Preview: Bill opens modal with real print layout preview; payment opens modal displaying dictated text beside matched party.
  * Reject: Bill sets `status: 'rejected'`; payment calls `rejectPaymentDraft` (dead-end, status becomes `rejected`).
  * Approve (Sales Bill): Clicking **Load** serializes draft to `sessionStorage` and navigates to `/new-bill`.
  * Approve (Sales Payment): Clicking **Accept** opens `PaymentAcceptModal`, verifies party/amount, and calls `savePaymentFromDraft` which creates the live payment and approves the draft.

---

## 3. Workflow (Dictation to Live Record)

### Sales Bill
1. **Muse:** Parses dictation $\rightarrow$ stages `bill_drafts` + `bill_draft_items` with `status: 'pending_review'`.
2. **Owner Action (Review):** Opens `/drafts` $\rightarrow$ inspects party, items, and totals $\rightarrow$ clicks **Load** (`src/routes/drafts.tsx:162`).
3. **Owner Action (Edit):** Form loads in `/new-bill` with banner `Editing Muse AI Draft` $\rightarrow$ verifies book/bill number, rates, GST $\rightarrow$ clicks **Save Bill**.
4. **System:** `saveBillWithItems` (`src/data/bills.ts:123`) executes atomic PocketBase batch (`bills.create`, `bill_items.create`, `payments.create`, `bill_drafts.update` to `approved` with `converted_bill`).

### Sales Payment (Receipt)
1. **Muse:** Parses receipt dictation $\rightarrow$ stages `payment_drafts` record with `status: 'pending_review'`.
2. **Owner Action (Review):** Opens `/drafts` $\rightarrow$ clicks **Accept** on payment row (`src/routes/drafts.tsx:295`).
3. **Owner Action (Confirm):** In `PaymentAcceptModal`, confirms matched party, checks current live amount due, adjusts mode/note $\rightarrow$ clicks **Accept · ₹X**.
4. **System:** `savePaymentFromDraft` (`src/data/payment-drafts.ts:93`) checks `status === 'pending_review'`, executes atomic batch (`payments.create`, `payment_drafts.update` to `approved` with `converted_payment`).

### Purchase Bill (Planned)
1. **Muse:** Parses inward scrap slip $\rightarrow$ stages `purchase_bill_drafts` payload (supplier, date, pool, lines in integer grams/milli-rupees/paise, bardan, payment) with `status: 'pending_review'`.
2. **Owner Action:** In `/drafts`, previews parsed slip beside dictation $\rightarrow$ clicks **Review & Edit** $\rightarrow$ opens `/new-purchase-bill` prefilled.
3. **Owner Action:** In `PurchaseBillEditor`, resolves any unmatched scrap items, confirms weight/rate, bardan method $\rightarrow$ clicks **Save Purchase Bill**.
4. **System:** `createPurchaseBill` creates `purchase_bills`, lines, adjustments, bardan, payment, allocations, and marks draft `approved` in one atomic transaction.

### Purchase Payment (Planned)
1. **Muse:** Parses supplier payout dictation $\rightarrow$ stages `purchase_payment_drafts` (supplier, date, pool, kind, amount_paise, mode).
2. **Owner Action:** In `/drafts`, reviews pool-specific payable balance $\rightarrow$ clicks **Accept** or opens `/new-supplier-payment`.
3. **Owner Action:** Confirms bill pins or FIFO allocation $\rightarrow$ clicks **Save Payment**.
4. **System:** `createSupplierPayment` creates payment, allocations, and approves draft in one atomic batch.

### Casting Session (Planned)
1. **Muse:** Parses foundry heat dictation $\rightarrow$ stages `casting_session_drafts` (date, coal, worker salary, batches, input materials, wire out, mel).
2. **Owner Action:** In `/drafts`, checks calculated loaded cost/yield $\rightarrow$ clicks **Review & Edit** $\rightarrow$ opens `/casting/new-session`.
3. **Owner Action:** Confirms material master items $\rightarrow$ clicks **Save Session**.
4. **System:** Refactored `saveCastingSession` creates session, batches, inputs, and marks draft `approved` in one atomic batch.

---

## 4. Permissions (Security Audit from Migrations)

Effective API rules evaluated chronologically across all migrations:

| Collection | List Rule | View Rule | Create Rule | Update Rule | Delete Rule | Audit Finding / Who Can Access |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`bills`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_bills.js`. Anyone or Muse can read/write live bills. |
| **`bill_items`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_bill_items.js`. Anyone or Muse can modify live invoice items. |
| **`payments`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_payments.js`. Anyone or Muse can create/edit live receipts. |
| **`customers`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_customers.js`. Anyone or Muse can modify customer records. |
| **`items`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_items.js`. Anyone or Muse can edit sales item master. |
| **`brass_rates`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** restored by `1792914000_restore_public_rules_rates_stock.js`. |
| **`bill_drafts`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792835225_updated_bill_drafts.js`. Anyone or Muse can modify/approve drafts. |
| **`bill_draft_items`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792843386_created_bill_draft_items.js`. |
| **`bill_draft_payments`**| `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1792843386_created_bill_draft_payments.js`. |
| **`payment_drafts`** | `""` | `""` | `""` | `""` | `""` | ⚠️ **PUBLIC (UNRESTRICTED)** from `1793620269_created_payment_drafts.js`. Anyone can forge or alter payment drafts. |
| **`suppliers`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** `@request.auth.id != "" && @request.auth.role != "muse"` (`1794640004`). |
| **`purchase_items`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`purchase_bills`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`purchase_bill_lines`**| `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`purchase_bardan`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`supplier_payments`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`supplier_payment_allocations`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Only operator can read/write. Muse blocked. |
| **`purchase_audit_log`** | `non-muse` | `non-muse` | `non-muse` | `null` | `null` | ✅ **SECURE & IMMUTABLE.** Non-muse can create/view; update & delete are `null` (forbidden). |
| **`casting_sessions`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Locked by `1787393500`. Muse cannot touch casting. |
| **`casting_batches`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Locked to operator only. |
| **`casting_batch_inputs`**| `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Locked to operator only. |
| **`casting_materials`** | `non-muse` | `non-muse` | `non-muse` | `non-muse` | `non-muse` | ✅ **SECURE.** Updated by `1794640006`. |
| **`app_settings`** | `signedIn` | `signedIn` | `null` | `owner` | `null` | ✅ **SECURE.** Any signed-in user can read; only owner can update; creation/deletion forbidden (`1794640004`). |

*Note on Rules:* `""` means public anonymous access without headers. `null` means strictly forbidden for all API tokens (superuser only).

---

## 5. Plan Check (Phase by Phase)

### Phase 1: Contracts & Security
* **What Already Exists:** Zod installed; PocketBase modern `fields` migration syntax used in `1794640004_created_app_settings.js`; `users.role` select field exists (`"operator"`, `"muse"`).
* **What is Missing:** 3 draft collections (`purchase_bill_drafts`, `purchase_payment_drafts`, `casting_session_drafts`); Zod schemas for the 3 JSON payloads; API rule migration tightening the wide-open Sales draft and live tables; unique index on `(source_message_id, created_by)`.
* **Files to Touch:** `pb_migrations/1794640008_*.js`, `src/domain/draft-schemas.ts` (new), `tests/api-rules.test.ts` (new).
* **Risk:** **High**. Sales collections are currently `""` (public). Tightening them must not break operator browser sessions or offline/service workers.
* **Plan Discrepancy:** The plan states existing migrations set `bill_drafts` to "any signed-in user"; in reality, `1792835225_updated_bill_drafts.js` set it to `""` (completely public).

### Phase 2: Purchase Bill
* **What Already Exists:** `PurchaseBillEditor` (`src/components/suppliers/purchase-bill-editor.tsx`) has page/modal modes and an empty `<div data-muse-input-slot hidden />`; `createPurchaseBill` (`src/data/suppliers.ts:525`) runs confirmed atomic batches with audit logs.
* **What is Missing:** `purchase_bill_drafts` collection; draft parsing/validation logic; `PurchaseBillEditorProps` does not accept `draftId` or initial draft data; `createPurchaseBill` does not link or transition drafts in its batch; no preview modal in `/drafts`.
* **Files to Touch:** `src/components/suppliers/purchase-bill-editor.tsx`, `src/routes/new-purchase-bill.tsx`, `src/data/suppliers.ts`, `src/data/purchase-bill-drafts.ts` (new), `src/routes/drafts.tsx`.
* **Risk:** **Medium**. Strict integer math (`weight_g`, `rate_milli`, `amount_paise`) and pool rules must not be bypassed or converted via float during staging.
* **Plan Discrepancy:** None.

### Phase 3: Purchase Payment
* **What Already Exists:** `/new-supplier-payment` route; `createSupplierPayment` (`src/data/suppliers.ts:893`) writes payment + allocations + audit log in confirmed batch.
* **What is Missing:** `purchase_payment_drafts` collection; draft loader/view mapper; draft accept modal in `/drafts`; `createSupplierPayment` does not accept `draftId` or transition draft status in its batch.
* **Files to Touch:** `src/routes/new-supplier-payment.tsx`, `src/data/suppliers.ts`, `src/data/purchase-payment-drafts.ts` (new), `src/routes/drafts.tsx`.
* **Risk:** **Medium**. Preventing duplicate payment entries when a bill already contains an on-bill payment.
* **Plan Discrepancy:** None.

### Phase 4: Casting Session
* **What Already Exists:** `/casting/new-session` route; `saveCastingSession` in `src/data/casting.ts`; cost calculations in `src/domain/casting-calculations.ts`.
* **What is Missing:** `casting_session_drafts` collection; draft loader; draft handoff to editor; **atomic batch save** (`saveCastingSession` is currently non-atomic sequential requests).
* **Files to Touch:** `src/data/casting.ts`, `src/routes/casting/new-session.tsx`, `src/data/casting-session-drafts.ts` (new), `src/routes/drafts.tsx`.
* **Risk:** **High**. `saveCastingSession` must be rewritten from loose loops with compensating deletes to a single `pb.createBatch()` request.
* **Plan Discrepancy:** The plan correctly identifies this non-atomic risk.

### Phase 5: Universal Inbox & Muse Contract
* **What Already Exists:** `/drafts` page with polling, search, status/type filters, and modal previews for Sales.
* **What is Missing:** Server-side pagination across multiple collections; module toggle integration (`app_settings`); tabs/lanes for Purchase and Casting; updated Muse integration guides.
* **Files to Touch:** `src/routes/drafts.tsx`, `docs/archive/muse/*`, new `docs/muse/MUSE_INTEGRATION_SPEC_2026.md`.
* **Risk:** **Medium**. Client-side combining of 5 separate collections will degrade performance unless refactored with server-side paging.
* **Plan Discrepancy:** None.

---

## 6. Atomicity & Concurrency Audit

| Operation | Current Implementation | Atomic? | Double-Posting / Partial Save Vulnerabilities |
| :--- | :--- | :---: | :--- |
| **Sales Bill Save** | `pb.createBatch()` in `src/data/bills.ts:135-190` creates bill, lines, payments, and marks draft `approved`. | **Yes (Single Batch)** | **Double-posting possible:** No server-side check that `status == 'pending_review'`. If two operators click Save or network retries occur, two real bills can be generated for one draft. |
| **Sales Payment Accept** | `pb.createBatch()` in `src/data/payment-drafts.ts:121-140` creates payment and marks draft `approved`. | **Yes (Single Batch)** | **TOCTOU Race condition:** Client reads `getOne` (line 109) before sending the batch. Two concurrent requests can both read `pending_review` and both post payments. |
| **Purchase Bill Save** | `executeConfirmedBatch()` in `src/data/suppliers.ts:537-627` batches header, lines, adjustments, bardan, payment, allocations, audit log. | **Yes (Single Batch)** | Photo upload is a second call (acceptable, non-fatal). Draft transition is not yet integrated. |
| **Purchase Payment Save** | `executeConfirmedBatch()` in `src/data/suppliers.ts:903-950` batches payment, allocations, audit log. | **Yes (Single Batch)** | Photo upload is a second call. Draft transition is not yet integrated. |
| **Casting Session Save** | `src/data/casting.ts:517-555`: 1 `create` session $\rightarrow$ loop `create` batches $\rightarrow$ loop `create` inputs. | ❌ **NO (Multiple Sequential Calls)** | **High Risk of Partial Saves:** If browser loses connection midway, session or batches remain orphaned in the DB. Catch block attempts compensating deletes (`Promise.allSettled`), which can fail silently. |

---

## 7. Inbox (`/drafts`) Audit

* **How It Fetches & Paginates Today:**
  * Defines `LANE_FETCH_LIMIT = 200` (`src/routes/drafts.tsx:31`).
  * Runs 2 separate React queries: `loadDraftPage({ page: 1, perPage: 200 })` and `loadPaymentDraftPage({ page: 1, perPage: 200 })`.
  * Merges the two arrays in browser memory: `rows: DraftRow[] = [...]` (line 89).
  * Sorts in memory: `rows.sort((a, b) => b.view.created.localeCompare(a.view.created))`.
  * Slices in memory for UI pagination: `rows.slice((currentPage - 1) * 25, currentPage * 25)`.
  * Polls every 8 seconds via `pollWhileTabVisible(8000)`.
* **What Breaks When 3 Collections Are Added:**
  1. **Network Bloat:** Fetching up to 200 records $\times$ 5 collections = up to 1,000 records transferred and parsed every 8 seconds.
  2. **Data Truncation:** Drafts past the 200th record in any collection are silently excluded from sorting and pagination.
  3. **Search Inconsistency:** Server-side search runs separately against each collection with different field names (`customer_name` vs `supplier` vs `material_name`), causing erratic multi-collection search results.
  4. **Module Gate Blindness:** `/drafts` currently does not check `app_settings` / `useModuleSettings()`. Disabled modules (e.g. Casting disabled) will still fetch and show drafts on the main screen unless module filters are added.

---

## 8. Top 10 Ranked Risks & Gaps

1. **Wide-open public write permissions on live financial collections:**
   `pb_migrations/1792835225_updated_bills.js:7-11`, `1792835225_updated_payments.js:7-11`, `1792835225_updated_bill_items.js:7-11`. Live sales bills, bill items, payments, customers, and items have `createRule: ""` and `updateRule: ""` (completely open to public/unauthenticated and Muse).
2. **Wide-open public permissions on existing draft collections:**
   `pb_migrations/1792835225_updated_bill_drafts.js:7-11`, `1793620269_created_payment_drafts.js:6-10`. Anyone can modify, forge, or mark drafts `approved` without owner review.
3. **Casting session save is non-atomic with loose compensating deletes:**
   `src/data/casting.ts:517-561`. Session, batches, and batch inputs are saved in separate sequential API calls. Network drops or tab closing leaves partial foundry data in PocketBase.
4. **Sales bill conversion double-posting under concurrency:**
   `src/data/bills.ts:182-191`. Batch updates `bill_drafts` status to `approved` without a server-side check that it was `pending_review`. Concurrent clicks create multiple official bills.
5. **TOCTOU race condition on payment draft acceptance:**
   `src/data/payment-drafts.ts:109-139`. Client reads `getOne` to check status, then sends batch. Two rapid clicks or two browsers both pass the check and create duplicate payment records.
6. **Loaded draft state lost on browser refresh:**
   `src/routes/new-bill.tsx:1344-1353`. Draft is consumed from `sessionStorage` and immediately deleted (`sessionStorage.removeItem`). If the operator hits refresh, the draft is wiped out from the form.
7. **Inbox in-memory pagination collapses at scale:**
   `src/routes/drafts.tsx:31-98`. Merging 5 collections $\times$ 200 rows in memory every 8s causes UI stutter, high network usage, and silently drops records past 200.
8. **Drafts inbox ignores module settings toggles:**
   `src/routes/drafts.tsx:37-143`. `drafts.tsx` does not check `app_settings`. If Purchase or Casting is turned off in `/settings`, their pending drafts will still show up and pollute the inbox.
9. **No draft ingestion props in Purchase Bill Editor:**
   `src/components/suppliers/purchase-bill-editor.tsx:434-441, 1035`. `PurchaseBillEditorProps` has no `draftId` or initial data hook, and the muse input slot (line 1035) is an unrendered placeholder.
10. **Purchase float-to-integer rounding drift risk:**
    `docs/features/muse-purchase-casting-drafts-plan.md:28` vs `src/data/suppliers.ts:564-566`. If Muse dictation parser outputs Rupees/Kg floats instead of integer `weight_g`, `rate_milli`, `amount_paise`, truncation errors will violate purchase ledger invariants.

---

## 9. Questions

1. **External API Clients (UNVERIFIED):** Are there any external scripts, WhatsApp webhooks, or mobile browsers currently accessing `bills`, `payments`, or `customers` without logging in? (Tightening the open `""` rules to require authentication will block unauthenticated scripts).
2. **Muse Dictation Ingestion Pipeline (UNVERIFIED):** Where does Muse run (cloud server, local daemon, or webhook) and what does it send as its stable idempotency key (`source_message_id`, WhatsApp message ID, or UUID)?
3. **Draft Architecture Preference:** Do you prefer the plan's proposed single JSON payload field (`payload`) for Purchase/Casting drafts (simpler, zero orphaned child rows), or dedicated relational child tables like Sales (`bill_draft_items`)?
4. **Casting Draft Scope:** Confirm that Casting drafts are strictly internal foundry sessions (coal, inputs, batches, wire out, mel) and never auto-generate casting job-work billing invoices.

---

### Recommended First Step

Begin strictly with **Phase 1 (Security & Schemas)**: write a new append-only PocketBase migration that tightens the open `""` rules on the Sales live tables (`bills`, `bill_items`, `payments`) and draft tables (`bill_drafts`, `payment_drafts`) to require `@request.auth.id != "" && @request.auth.role != "muse"` for live tables and `@request.auth.id != ""` for drafts, create the 3 new draft collections with JSON payload schemas and unique idempotency indexes, and write an isolated Vitest API test suite against mock auth tokens—all before adding UI loaders or inviting Muse to stage Purchase or Casting records.

---

### Commands Used to Verify Findings

```bash
# Branch status and modified files check
cd /home/arch/project/Kapil_pro && git status

# Search all muse documentation and specifications
find docs -iname "*muse*"
git grep -i "muse" -- 'src/**' 'README.md' 'docs/**'

# Line count audit of affected core files
wc -l src/routes/drafts.tsx src/data/bills.ts src/data/payment-drafts.ts \
      src/data/suppliers.ts src/data/casting.ts src/components/suppliers/purchase-bill-editor.tsx

# Parse and trace API rules chronologically across all 81 PocketBase migrations
cd /home/arch/project/Kapil_pro && /opt/miniconda3/bin/python -c '
import glob, json, re
migrations = sorted(glob.glob("pb_migrations/*.js"))
for m in migrations:
    # inspected collection definitions, unmarshal rules, and assignments
'

# Trace rule assignments on bills, drafts, purchase, and casting tables
head -n 25 pb_migrations/*1792835225*
head -n 25 pb_migrations/1794640004_setup_supplier_purchase_rules.js
head -n 30 pb_migrations/1792914000_restore_public_rules_rates_stock.js
head -n 25 pb_migrations/1794640006_items_active_and_casting_rules.js
head -n 30 pb_migrations/1794640004_created_app_settings.js

# Verify auth token and credentials presence (without printing secrets)
test -f /home/arch/project/Kapil_pro/runtime/state/muse-credentials.json && echo "present" || echo "absent"

# List and audit all active TanStack Router routes
find src/routes -type f | sort
```
