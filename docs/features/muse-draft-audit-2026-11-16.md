# Muse draft workflow audit — 16 Nov 2026

Scope: Sales bill/payment, Purchase bill/payment, Casting session staging; owner review; API permissions. Arch development runtime only. No real write request was sent to the running PocketBase database. This audit does not certify every UI interaction or future Windows deployment.

## Verification run

| Check | Result |
| --- | --- |
| `npm run verify` | Pass: typecheck, 533 tests passed, 2 skipped, build passed |
| Disposable PocketBase draft-rule test + parser/inbox tests | Pass: 10 focused tests; covers pending draft creation, update, approval denial, repeat-save rollback for Purchase/Casting |
| Windows package test | Pass: 3 tests |
| 10,000 deterministic decimal/line-math cases | Pass: exact gram, milli-rupee, paise conversion |
| Arch DEV Muse authenticated read-only API | Auth 200; all six permitted master lists readable. Muse sees 1 of 26 Sales bill drafts, consistent with own-draft filtering. Purchase/Casting draft lanes currently have zero records. |
| `/drafts` browser smoke | No page errors; pending 0, history 25 visible, search empty state works, no document-wide horizontal overflow at 390px. |
| `npm run lint` | Fail: 9 errors, 80 warnings in unrelated charts/dashboard/calendar code. No Muse draft lint errors identified. |

## Findings, ordered by risk

### Critical: stock API remains publicly writable by rule

`pb_migrations/1792914000_restore_public_rules_rates_stock.js` sets list/view/create/update/delete rules to empty strings for `stock_in`, `stock_adjustments`, and `stock_openings`. Anonymous and Muse reads show the same nonzero counts as the operator for `stock_in` (16) and `stock_openings` (3). No write was attempted. PocketBase empty write rules permit anonymous requests, so the current rule set does not enforce the stated Muse write boundary for these collections. Before tightening, map any operator paths relying on anonymous access; then use an append-only migration and disposable permission tests.

### High: bardan `advance` in a Purchase bill draft does not create its credit

`parsePurchaseBillDraft(2, ...)` accepts `bardan[].method = "advance"`. The editor passes it into `createPurchaseBill` (`src/components/suppliers/purchase-bill-editor.tsx`). That batch writes a `purchase_bardan` row but has no `supplier_payments` `bardan_advance` creation (`src/data/suppliers.ts`, purchase bill create path). The later `addPurchaseBardanEntry` path does create the credit. A draft saved with advance bardan therefore has a different supplier balance from the same entry added after the bill. Add the credit and audit row to the bill's atomic batch; test settlement in both pools and retry behavior.

### High: some valid draft fields are lost or silently changed before save

- V2 `vehicle_no` parses successfully but is not loaded into the Purchase editor or passed as `vehicleNo` to `createPurchaseBill`; the live bill gets an empty vehicle number.
- `private_note` containing `[bags_at_receipt:2.500]` loses that literal tag when `formatPrivateNoteWithBags` runs. The draft does not populate the separate bags-at-receipt input, so the kg can disappear too.
- `pool: "gst", tax_mode: "none"` parses as valid and becomes `gst`; `pool: "kacha", tax_mode: "gst"` becomes `none`. Explain the coercion in review or reject contradictory inputs.

### Medium: valid payloads can be impossible to save, or can silently lose relations

The disposable parser probes returned `valid` for a Purchase bill with rate `"0"`, a NEFT on-bill payment with no reference, `gst_rate_bp: 100000` (1000%), `bardan.rate_line_index: 99` with one line, and `advance` bardan with no `credit_rs`. The editor/backend rejects zero rate and bank payment without reference; the out-of-range line index becomes an empty relation, and a missing advance credit becomes zero. Purchase payment drafts with `mode: "neft"` and no reference also parse valid but fail on save. Validate these cross-field constraints at the draft boundary and show actionable warnings for editable omissions.

Live Purchase adjustments allow signed `labour`, `transport`, and `other`, but v2 draft negative amounts fail the intermediate nonnegative v1 schema. Align the parser with live signed-money rules while retaining positive-only quality cuts.

### Medium: Casting draft checks allow physically inconsistent proposals

The parser returns `valid` for zero wire output, an empty material-input list, and wire output greater than input. The editor blocks an entirely empty session and zero total wire output, but a batch without material input can coexist with a valid batch; yield above 100% has no hard validation. Choose business-approved yield limits and validate each batch before save. Extremely large, individually safe decimal inputs can also overflow practical Casting cost precision; set realistic upper bounds.

### Medium: Sales draft review is not reload-safe

`/drafts` puts the Sales bill draft in `sessionStorage`; `/new-bill` consumes and removes it on first load. `loadedDraftId` is component state and is not persisted with the local form state. A refresh can leave form values but lose the draft ID, allowing a manual bill save without approving/linking the draft. Use a validated route draft ID and rehydrate the current pending draft, as Purchase and Casting already do.

### Lower: inbox search covers only fetched rows

Each lane loads at most 50 records and search runs in the browser. An older matching draft outside those 50 cannot appear, even with Show history. Add server-side search/pagination once draft volume warrants it; keep a clear “recent 50 per type” label until then.

### Lower: aggregate money can exceed safe integer range

Each Purchase line is parsed as a safe integer, but `computeBillNet` sums line amounts as JavaScript numbers without checking the aggregate. A synthetic two-line input at `Number.MAX_SAFE_INTEGER` paise per line produced an unsafe result. Apply a checked sum and realistic bill/weight/rate caps before financial calculation. This is an extreme-value edge case, not evidence of current corrupted records.

## Coverage limits and next test additions

Current disposable API tests do not exercise Sales draft child-row ownership and deletion, or deletion of Purchase/Casting pending drafts by Muse. They use minimal collections and do not model the later `stock_*` migration. Add a disposable permission matrix for every collection and verb, including anonymous requests, two Muse identities, and operator. Add a batch-level test for bardan advance creation, GST rate limits, line-index validation, bank-reference validation, Sales reload continuity, and per-batch Casting yield checks. No real Arch or Windows data should be used for these write tests.
