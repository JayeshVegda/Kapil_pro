# Muse drafts for Purchase and Casting — implementation plan

**Status:** Planning only, 15 November 2026. No application code, data, or migration has been changed for this plan. Build on `feat/muse-integration`, one finished phase at a time.

## Decision and scope

| Question | Owner decision |
| --- | --- |
| Which new Muse outputs? | Purchase Bills, standalone Purchase Payments, and Casting Sessions. Casting job-work bills are out of scope. |
| Where are they reviewed? | One `/drafts` inbox, with Sales preserved. |
| Who posts real records? | The owner, after opening a prefilled existing editor, correcting it, and explicitly saving. Muse only stages proposals. |
| Module boundaries? | Sales `customers`/`items`, Purchase `suppliers`/`purchase_items`, and Casting `casting_materials` stay isolated. No cross-module name or ID matching, balance netting, or automatic stock movement. |

## What exists now

- `/drafts` (`src/routes/drafts.tsx`) combines Sales `bill_drafts` plus `payment_drafts`, polls, previews, rejects, and loads bill drafts into `/new-bill`. Sales bill items and bill-borne payments are separate child collections. Standalone Sales payment approval creates a real payment and marks its draft approved in one PocketBase batch (`src/data/payment-drafts.ts`). Sales bill save batches bill, lines, payment, and draft update (`src/data/bills.ts`). Keep that behavior and its routes.
- The Muse guides in `docs/archive/muse/` describe the existing Sales contract: authenticate as Muse, stage pending drafts, use atomic batch for header and children, explain uncertainty, avoid duplicates, then stop; the owner converts in AI Drafts. They also explicitly prohibit Muse writing live bills/payments or casting records. These guides predate the three-module design, so update the Muse-facing contract **after** the new schema and permissions are deployed; do not treat old API examples as authority for Purchase/Casting.
- Purchase saves run through `createPurchaseBill` and `createSupplierPayment` in `src/data/suppliers.ts`, with integer grams, milli-rupees, and paise, pool separation, confirmed batch writes, and audit rows. The bill editor is shared between page and modal (`src/components/suppliers/purchase-bill-editor.tsx`); payment entry is `/new-supplier-payment`.
- Casting sessions are entered at `/casting/new-session` and saved by `src/data/casting.ts`. Its current create path writes the session, then batches and inputs in separate requests with compensating cleanup. Draft approval must make the entire conversion atomic before it can safely mark a draft approved.
- `app_settings` controls Purchase and Casting visibility. The inbox and its counts must respect those settings, while disabled-module drafts remain stored for later review.

## Draft contract and boundaries

Create **three new top-level draft collections** with new append-only PocketBase migrations; use a JSON payload for each proposal to avoid creating live-record relations or partially staged child trees. The operator-side parser validates the payload against a versioned Zod schema. Store `schema_version`, `status` (`pending_review` / `approved` / `rejected`), `created_by`, `source_message_id` or other stable Muse idempotency key, exact `raw_text`, `confidence`, `notes`, `created`, `updated`, and one `converted_*` relation set only by the owner-side approval path. Scope the unique idempotency key by draft type and Muse account. Retain the original dictation and corrected values separately for audit/review. Avoid storing secrets in draft text or logs.

| Collection | Proposed payload | Approval target and checks |
| --- | --- | --- |
| `purchase_bill_drafts` | Supplier name/optional same-module ID, bill date, optional supplier bill number, `kacha`/`gst` pool, tax mode/rate, vehicle, lines (purchase item name/optional ID, **integer** `weight_g`, `rate_milli`, `amount_paise`), optional adjustments, bardan entries, optional on-bill payment. | `/new-purchase-bill` via shared editor. Require explicit supplier and item confirmation, recompute line amounts and whole-rupee net, validate tax/RCM and bardan methods, obtain FY `in_no` only on save. Do not let Muse invent an inward number. |
| `purchase_payment_drafts` | Supplier name/optional same-module ID, date, pool, one of the supported payment kinds, **integer** `amount_paise`, mode/reference/payee/note; optional proposed bill pins by ID. | `/new-supplier-payment`. Show current pool-specific due and FIFO/pin impact before save; validate supplier, kind, mode, allocations, and pool. The same money must not also appear in an on-bill draft payment. |
| `casting_session_drafts` | Date, note, coal kg/rate, worker wages, ordered batches with input material names/optional **casting-only** IDs, qty/rate, wire out and mel. | `/casting/new-session`. Recompute cost/yield/wastage with `src/domain/casting-calculations.ts`; require real material selection and valid positive inputs/output before save. No job-work bill or inventory entry is auto-created. |

For uncertain names or quantities, Muse stages the dictated text with low confidence and a visible warning; it never creates master parties/items. Match only within the target module, and require the owner to resolve ambiguous or inactive masters. Backdated rate lookup and current casting defaults may be suggested by the editor, but must not silently overwrite values explicitly dictated in the draft. Photos/attachments are a later extension unless their limits, access rules, and review UI are defined.

## `/drafts` owner workflow

1. One inbox with module chips (Sales, Purchase, Casting), type/status filters, source/date/party search, pending count, age, confidence, and a clear unmatched/needs-review state. Use server-side pagination and filtering; the current Sales inbox fetches only 200 per lane before client-side pagination, so fix this when adding lanes. Hide disabled-module lanes and counts, retaining their records. Use the Kapil UI kit (`Panel`, `DataTable`, `StatusChip`, `ConfirmDialog`, `buttonClass`), centered dialogs, and the current slate/Geist tokens.
2. Preview each proposal with its **original dictation beside parsed fields** and module-specific checks: Purchase pool and payable impact, payment kind and allocation impact, Casting input/output and cost summary. Label AI suggestions and unresolved fields. Reject with confirmation and optional reason; keep rejected/approved history read-only.
3. **Review & edit** opens the existing editor prefilled, carrying the draft ID in a validated route/search or scoped handoff state that survives refresh. The editor shows a draft banner and blocks accidental loss. The owner corrects fields and clicks the editor's normal Save action. Opening the editor alone never approves.
4. On save, re-read draft status server-side, validate module is enabled and `pending_review`, create all live records, and set `approved` plus `converted_*` in the **same transaction**. Repeated clicks, stale tabs, lost responses, or retries must resolve to the already converted record, never post twice. A server-side rule/hook or conditional transition must close the concurrent-approval gap; a client `getOne` check alone is insufficient. Rejection must similarly be owner-only and pending-only. Invalidate centralized query keys after commit and show the saved record link.

## Security gate before inviting Muse to use new lanes

Audit effective PocketBase API rules for **every** Sales draft and live financial collection with the Muse identity, not just documented intent. Existing migrations set `bill_drafts` updates to any signed-in user and some draft-child/payment-draft rules to `""` (public); migration history alone does not prove the current deployed state. Add a new migration to tighten those rules and enforce field/status ownership. Muse may create and correct its own *pending* draft payloads, read only the masters needed for matching and its draft outcomes, and must be denied live bill, payment, party, item, casting, and purchase writes. The operator alone can approve/reject/set `converted_*`. Never trust a `created_by` value supplied in the body; derive/check it from authentication. Test with both operator and Muse tokens against a disposable PocketBase database. Do not paste tokens or credentials into tests, docs, or logs.

## Phases, each independently reviewable

1. **Purchase draft foundation, staged security:** Create only `purchase_bill_drafts` and its versioned payload validator first; add the server `created_by` hook with an anonymous-tolerant path. Keep the rules migration in `staged_migrations/`, outside PocketBase's active `pb_migrations/` directory, until the owner verifies Muse's authenticated login and explicitly authorizes installation. Run isolated before/after API-rule tests. Before any Windows PocketBase restart, run `windows\backup-kapil.ps1`; pending active migrations apply on restart. Purchase Payment and Casting draft schemas follow in their own phases.
2. **Purchase Bill:** Add draft loader/preview to `/drafts`, prefill `PurchaseBillEditor`, and extend `createPurchaseBill`'s confirmed batch to transition the draft atomically. Keep the existing bill entry path unchanged for manual use. Test whole-rupee net, GST vs RCM, bardan, on-bill payment, FY numbering, and repeat approval.
3. **Purchase Payment:** Add draft loader/preview and prefill `/new-supplier-payment`; extend `createSupplierPayment` confirmed batch for atomic conversion. Test both pools, every payment kind, manual pins, no duplicate on-bill money, and retry reconciliation.
4. **Casting Session:** Add loader/preview and prefill `/casting/new-session`; refactor `saveCastingSession` so session, batches, inputs, and draft transition commit as one batch. Test cost recalculation, missing materials, multi-batch data, rollback, and repeat approval.
5. **Universal inbox and Muse contract:** Consolidate the four draft types in `/drafts` with server-side paging/counts, module-toggle behavior, history, and explicit resolution cues. Update the active Muse integration instructions with exact new field contracts and example calls **only after** deployed schema/rules match them; mark archived Sales guides historical and avoid copying obsolete claims. Run end-to-end staging with a disposable DB and verify Muse is denied direct live writes.

## Verification and release

- `npm run verify` after each code phase; `cd windows && npx vitest run windows-package.test.ts` before packaging. Add targeted tests for schema validation, permissions, atomic conversion, duplicate/retry behavior, module toggles, and inbox pagination. Use mocks or isolated disposable PocketBase only; never test, seed, migrate, or inspect by writing to `runtime/data/data.db`.
- Manual smoke on a disposable instance: stage one of each draft as Muse, see it in `/drafts`, review/edit/save as operator, confirm one live record and one approved link, reject another, retry save, and confirm disabled modules disappear without losing drafts. Verify Sales draft behavior still works.
- Production rollout: owner runs `windows\backup-kapil.ps1`, then restarts Windows PocketBase to apply pending migrations; check backup and health before giving Muse the updated instructions. Do not push master or change live listeners. Stop after a complete phase if time is short.

## Risks to resolve during implementation

1. **Actual permissions may violate the draft-only promise.** Public/any-auth draft rules and potentially older live rules require an effective-rule audit and tightening before Muse is enabled for Purchase/Casting.
2. **Double posting under concurrency.** Sales bill conversion currently updates a draft in a batch without a server-enforced pending-to-approved condition; client prechecks cannot fully serialize two reviewers. Reuse the improved gate across all lanes.
3. **Partial Casting saves.** Current session creation spans multiple API calls; approval must be atomic or a failure can leave inconsistent foundry records and an unapproved draft.
4. **Purchase semantics and precision.** Never convert grams/milli-rupees/paise through floats; never cross `kacha`/`gst` pools or add RCM to supplier payable.
5. **Stale Muse guides and disabled modules.** Archived guides prohibit casting and describe Sales-only collections; update the live contract after rollout and preserve hidden pending drafts when modules are toggled off.
