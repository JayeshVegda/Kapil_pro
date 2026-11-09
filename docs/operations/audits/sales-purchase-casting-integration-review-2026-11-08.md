# Kapil Pro — Sales / Purchase / Casting integration review & recommendation

**Date:** 8 November 2026
**Audience:** project owner, and the next implementation agent after design approval.
**Reader job:** confirm the integration direction, then approve phases (or send back changes). No code has been changed for this report.
**Reviewed state:** `feat/muse-integration`, HEAD `06de703`, plus the existing uncommitted worktree. Repo test suite at review time: **364 passed / 2 skipped**; `tsc --noEmit` clean.
**Scope:** navigation & information architecture, module switches, dashboards, shared screens, metric definitions, reporting, and the defect list found while verifying each area.
**Companion doc:** `docs/operations/audits/purchase-review-2026-11-07.md` (11-finding purchase audit; several findings there are now fixed — see Appendix A).

---

## 1. Executive summary

Kapil Pro is three businesses in one app — **customer sales**, **supplier scrap purchases**, and **furnace casting** — sharing one PocketBase database, one layout shell, and one dashboard. Sales is polished and battle-tested. Purchase is mid-development with real financial-engine depth (pools, bardan, advances, settlement). Casting is barely used and its Logs editor has known gaps.

The integration problem is not the engines — they are correctly separate. It is that **the surfaces around them diverged**: navigation order, naming, dashboards, reports, module switches, and even what "we owe" means on each screen. A second class of problem is **verified defects** in purchase metrics semantics, casting edit/trash behavior, backup coverage, and a mislabeled payment feed.

### Recommendation

**Incremental integration.** Keep the three financial engines separate. Integrate at the shell level: one navigation grammar, one screen layout grammar, one reporting adapter layer, one switches model. Fix the verified defects first, in a dedicated phase, because two of them (purchase metric semantics, backup coverage) get worse the longer the surface area grows around them.

Three reasons this beats the alternatives (full trade-offs in §9):

1. **The engines encode real business rules that differ.** Sales bills/payments, purchase pools with bardan + advances, and casting batches/inputs are not variations of one ledger. Forcing them into one journal would break the settlement math the owner relies on.
2. **Every owner decision so far is a shell-level decision** (nav order, renamed entries, shared Logs design, shared Party screen, Setup Items administering all three). None of them require merging accounting.
3. **Reversibility.** Shell-level changes are routing/UI/read-layer only — no schema migration, no data rewrite, each phase independently rollback-able.

---

## 2. Verified defect list

Each item below was re-verified against source and/or the running app during this review. Severity reflects business impact today.

### D1 · Purchase "what we owe" is presented inconsistently across screens (High)

`loadSuppliersSummary` returns the settlement **net position** under the field name `outstandingPaise` (`src/data/suppliers.ts:1226` — `outstandingPaise: settlement.combined.netPositionPaise`, where `netPositionPaise` is defined as *outstanding − advance* in `src/domain/supplier-settlement.ts:180`).

Consumers then treat that field differently:

- **Purchase Dashboard "Total We Owe"** sums `max(0, row.outstandingPaise)` (`src/routes/purchase-dashboard.tsx:48-50`) → shows the *net* number, then displays the same advance again as a "+ ₹1.12L advance" chip (`snapshot-tiles.tsx:72`). Live: We Owe ₹6.18L, advance chip ₹1.12L — gross owed is actually ₹7.30L.
- **Purchase Logs "Amount Owed"** shows `summaryKpi.totalDuePaise` (`purchase-logs.tsx:363`), which is the same net-of-advance sum (`purchase-log-metrics.ts:27`), again with "Available advance" repeated below.
- **Purchase Bills "Open due"** sums bill-level `duePaise` (`purchase-bills/index.tsx:347`) → the *gross* number.
- **`computePurchaseLogMetrics().netPositionPaise`** subtracts advances a second time (`purchase-log-metrics.ts:32`: `totalDuePaise − availableAdvancePaise`, where `totalDuePaise` is already net) — an exported field that returns a wrong value with real data. The unit test (`purchase-log-metrics.test.ts:35`) only passes because it feeds gross numbers into a field the data layer fills with net numbers.

**Impact:** an operator comparing Dashboard, Logs, and Bills gets three defensible-but-different answers to "how much do we owe suppliers," and the advance is visually double-counted. Future consumers of `netPositionPaise` inherit a silent error.

**Fix direction:** make `outstandingPaise` mean *gross outstanding (before advance)* at the boundary; expose `netPositionPaise` explicitly; each surface then labels exactly which one it shows (Dashboard tile: net, advance chip becomes context, or gross + advance with an explicit "= net" line — owner's call at spec time). Update the unit test to cover both meanings.

### D2 · Backup snapshot covers only the 5 Sales collections (High, data safety)

`buildBackupSnapshot` exports only `customers, items, bills, bill_items, payments` (`src/data/backup.ts:26-30`). Not covered: `suppliers`, `purchase_bills`, `supplier_payments`, `purchase_items`, `purchase_audit_log`, `casting_sessions`, `casting_batches`, `casting_batch_inputs`, `casting_materials`, `payment_drafts`. Every purchase and casting record in the app is absent from the in-app Backup page. (Operator-level SQLite backups via the Windows runbook do cover everything, but the in-app feature silently implies "your data is backed up.")

**Fix direction:** extend the snapshot to all business collections; add a collection count/coverage readout so the page itself proves coverage. No schema change.

### D3 · Casting Logs edit is flattened; trash restore loses batches (Medium-High for casting)

The Casting Logs edit schema accepts only date/unit/wireOut/wastage/cholIn/note + material rows (`src/routes/casting/log.tsx:130-146`). It cannot edit **furnace batches, coal kg, or worker salary**, which exist in the data layer (`src/data/casting.ts:35-37,91-110`). Separately, the deleted-entries snapshot used for trash/restore does not capture batches, so **restoring a deleted session cannot restore its batches** (material usage reporting then under-counts).

**Impact today is low** because casting is barely used — which is exactly why this must be fixed *before* integration makes casting more visible, not after.

**Fix direction:** widen the edit schema to the full session shape (or route edit through the same component used at session creation), and snapshot batches (+inputs) into the trash record so restore is lossless.

### D4 · Refunds and non-cash credits appear in "Recent Outgoing Payments" (Medium)

`RecentFeeds`'s payment feed receives the 5 newest payments unfiltered (`purchase-dashboard.tsx:281-283 → recent-feeds.tsx:73`), so `refund_received` and `settle_off` rows — which `supplierPaymentActivity` correctly classifies as incoming/non-cash (`purchase-log-metrics.ts:4-5`) — render under a card titled **Recent Outgoing Payments**. The KPI math already filters these out (`purchase-dashboard.tsx:115-118`), so the feed contradicts the tile above it. Live-verified: refund and settle-off credits listed as settled outgoing rows.

**Fix direction:** filter the feed with the same `direction === 'outgoing'` predicate (or label rows with their kind, and retitle the card "Recent Payments"). Logs page already presents refunds/non-cash as separate sub-lines (`purchase-logs.tsx:347`) — align the dashboard feed with that pattern.

### D5 · Module switches are half-built: Purchase has no switch, Casting figures leak (Medium)

`ModuleSettings` has only `castingEnabled` (`src/lib/module-settings.ts:9-11`); the Settings page offers only the Casting switch (live-verified). Consequences:

- Purchase cannot be hidden even though it is explicitly mid-development.
- Purchase Dashboard queries and displays casting consumption with **no gate** (`purchase-dashboard.tsx:34,96-110,224-235`) — switching Casting off hides its pages but its kg/cost figures still drive the purchase dashboard's material matrix and buffer.
- There is no disabled-module **history** pattern yet (see §6 for the agreed design).

**Fix direction:** add `purchaseEnabled` to `ModuleSettings` + Settings; gate casting-derived figures behind the casting switch wherever consumed; implement the read-only history toggle (§6).

### D6 · Sales Logs renders unpaginated; Purchase Logs title is generic (Low-Medium, UX)

- Sales Logs (`/transactions`) renders **all rows at once** — live-verified at 604 `<tbody>` rows on desktop and mobile; on a 390px viewport the table needs 920px of horizontal scroll. It will keep degrading as data grows.
- Purchase Logs (`/purchase-logs`) sets no page title — document title falls back to the generic shell title "Kapil Billing – Kapil Billing" (live-verified), so browser tabs/history can't distinguish it.

**Fix direction:** paginate (or virtualize) the shared Logs shell once and reuse it for all three modules (§7); set per-route document titles. URL/filter semantics unchanged.

### D7 · Live findings that motivate §4–§8 (not defects, verified gaps)

- Party Ledger is customers-only (live: ₹54.5L receivables; suppliers absent) — the only supplier ledger is the separate `/suppliers` hub.
- Company Report and Monthly Sales Calendar are sales-only.
- AI Drafts (`/drafts`) is sales-oriented.
- Mobile bottom nav is Home / Bill / Pay / Cast — no Purchase entry.
- The current sidebar group order is Dashboard, Sales, Customers, Purchases, Reports, Setup, Casting (`sidebar-nav.tsx:20-84`) with duplicate "Bills"/"Logs" labels across modules and inconsistent entry ordering (Purchase: Overview, Bills, **New Bill**, Payments, Suppliers, Logs).

---

## 3. Metric definitions (single source of truth)

These definitions are proposed as the shared vocabulary for every screen and report. One line each, with the owning domain module.

| Metric | Definition | Owner |
| :-- | :-- | :-- |
| **Gross outstanding** | Sum of unpaid bill dues for a party, before any advance/credit. | `supplier-settlement` (purchase); sales equivalent: receivable |
| **Advance held** | Unapplied supplier credit available to offset future bills (incl. bardan advance where applicable). | `supplier-settlement` |
| **Net position (we owe)** | Gross outstanding − advance held. Negative = we hold credit. | `supplier-settlement` |
| **Bill due** | Per-bill remaining due (gross); what a payment voucher settles against. | purchase bills / sales bills |
| **Paid out** | Cash-direction supplier payments (`paid_on_behalf` included, per `supplierPaymentActivity`). | `purchase-log-metrics` |
| **Refunds received** | `refund_received` payments — shown separately, never inside "paid out". | `purchase-log-metrics` |
| **Non-cash credits** | `settle_off`, `bardan_advance` — shown separately, never inside "paid out". | `purchase-log-metrics` |
| **Bardan pending** | Active bills flagged `bardanPending`; a settlement-workflow counter, not a rupee figure. | purchase domain |
| **Receivable** | Customer-side outstanding (sales), the mirror of gross outstanding. | sales ledger |
| **Casting consumed** | kg + cost of materials consumed by furnace sessions. | casting data |
| **Net material buffer** | Procured kg − consumed kg (inventory signal, not money). | purchase+casting adapters |

**Rule adopted by this report:** every money tile must state *which* of gross/net it shows when the two can differ, and the advance may only be displayed once per view. D1's fix enforces this at the boundary so all screens agree by construction.

Financial ordering stays as-is everywhere: **business date → created timestamp → record id**.

---

## 4. Navigation & information architecture (agreed design)

Sidebar group order becomes **Dashboard → Sales → Purchase → Casting → Reports → Setup**. Casting moves up beside its siblings; Customers folds into Sales (Customers + Party Ledger entries stay, under the Sales group).

**Sales group** (labels change; **URLs do not**):

| Label | Route |
| :-- | :-- |
| Sales Dashboard | `/` (new dedicated sales dashboard; see §5) |
| New Sale Bill | `/new-bill` |
| Sales Bills | bill list — today's Logs' Bills view promoted to its own entry, via `/transactions?type=bills` (no new URL; final shape at spec time) |
| New Sale Payment | `/new-payment` |
| Logs | `/transactions` (paginated; shared shell, §7) |
| Customers | `/customers` |
| Party Ledger | `/ledger` (becomes the shared parties screen, §7) |
| AI Drafts | `/drafts` (universal, §5) |

**Purchase group** — exactly the agreed order, Suppliers entry removed:

| Label | Route |
| :-- | :-- |
| Purchase Dashboard | `/purchase-dashboard` |
| New Purchase Bill | `/new-purchase-bill` |
| New Purchase Payment | `/new-supplier-payment` |
| Purchase Bills | `/purchase-bills` |
| Purchase Logs | `/purchase-logs` |

Suppliers remain fully reachable: **Party Ledger gains a Suppliers scope** (shared screen, separate profiles and accounting — no identity linking, merging, or balance offsets; §7).

**Casting group** unchanged in content (Dashboard, New Session, Casting Log, Materials, Casting Bill) at its new position.

**Reports group** order: **Calendar → Company Report → Module Reports → Exports** (`/monthly-sales-calendar`, `/monthly-report`, new `/module-reports`, `/export-reports`).

**Setup group** unchanged (Items, Issues, Data Health, Backup, Settings), with Items re-scoped per §8.

**Mobile bottom nav** becomes Home / Bill / Pay / **Purchase** / More (Cast moves under More or Home quick-actions; final pick at spec time), so purchase entry is thumb-reachable.

**Compatibility rule:** label changes are display-only. No route path changes in this plan; deep links, command bar, quick search, and bookmarks keep working. `isItemActive` matching (`sidebar-nav.tsx:131-145`) is updated to the new labels without path changes.

---

## 5. Dashboards (agreed design)

1. **Home = the uncategorized Company Dashboard (first).** `/` shows the whole business: sales vs collections, purchases, casting signal, calendar pressure — figures for switched-off modules excluded with the §6 notice. This replaces today's sales-only Home.
2. **Sales Dashboard** — the current Home's sales content (Sales vs Collections, Collect Next, Sold This Month, Recent Bills/Payments) moves to a dedicated screen inside the Sales group.
3. **Purchase Dashboard** — stays; becomes purchase-scoped (casting figures gated per D5), keeps Pay Next / material matrix / feeds with D4 fixed.
4. **AI Drafts (second, universal)** — `/drafts` becomes module-aware: sales drafts today, with the draft model extended so purchase bills/payments and casting entries can be drafted later. The shell (list, approve/reject, diff) is module-agnostic from the start.

---

## 6. Module switches & disabled-module history (agreed design)

- `ModuleSettings` gains `purchaseEnabled` (joins `castingEnabled`); Settings renders both switches with the same copy ("nothing here deletes data").
- **Disabled modules disappear from working views** (nav, command bar, quick search, dashboards' active figures) — the existing `isPathHiddenByModules` mechanism extended to purchase.
- **History stays reachable read-only:** a single "Include disabled-module history" toggle on Logs, Reports, and search results. Off (default): disabled-module rows hidden and excluded totals labeled ("excludes Casting: ₹X"). On: rows shown read-only — no edit/delete actions on disabled-module records.
- **No record deletion, ever, via switching.** Switching a module off is a view filter; data stays put.
- Casting-derived figures on the Purchase Dashboard are gated by the casting switch (D5).

---

## 7. Shared screens (agreed design)

**Shared Logs shell.** One Logs layout — filter bar, type tabs, status tabs, CSV, focus-by-id deep link — reused by Sales Logs, Purchase Logs, and (when casting use grows) Casting Log. The shell is presentation-only: each module keeps its own row model, actions, and accounting semantics (sales edit/delete; purchase cancel/reopen + audit trail; casting session edit). Pagination lives in the shell (fixes D6 once for all three).

**Shared Party Ledger.** `/ledger` serves both Customers and Suppliers with a party-type scope. **Deliberately not unified beyond the screen:** separate customer/supplier record types, separate accounting, no cross-module identity resolution, no netting a customer's receivable against a supplier's payable. Each party row opens the module's own ledger view with its own math.

**Universal AI Drafts.** As §5.4.

---

## 8. Setup: Items & reports (agreed design)

- **Setup → Items administers all three catalogs together** — selling products, raw scrap purchase items, and casting materials in one screen (the current `/items` already unifies the first two; extend with the casting materials catalog). Casting **material usage reporting is preserved** (`/casting/materials` keeps its usage report fed by session inputs).
- **Reporting:** Calendar and Company Report gain Purchase/Casting sections (procurement totals, furnace throughput, material buffer) with disabled-module exclusion notices; **Module Reports** (`/module-reports`) provides per-module tabs — Sales / Purchase / Casting — each with shareable URLs (month, module, tab encoded in search params). Reports order: Calendar → Company Report → Module Reports.

---

## 9. Approaches considered

### A · Incremental integration — **recommended**
Shared navigation, screen layouts, switches, and a reporting-adapter layer; three separate financial engines untouched.
✅ Matches every owner decision; each phase ships and rolls back independently; no schema migration; the 364-test suite keeps guarding sales math.
⚠️ Some intentional duplication remains (three Logs row models, two party record types) — accepted, because the duplication is *semantic*, not accidental.

### B · Deep unification (single party entity + unified journal)
One party table, one ledger/journal, all modules post to it.
✅ Maximum consistency; one query for "total business position."
❌ Highest risk by far: rewrites the settlement engine mid-purchase development; contradicts the agreed "shared screen, separate accounting"; a defect in the unified journal corrupts all three businesses at once; effectively irreversible once data migrates. **Rejected.**

### C · Defect-fixes only
Fix D1–D6, add the purchase switch, stop.
✅ Cheapest; kills the live financial-inconsistency risk.
❌ Leaves the agreed IA/dashboard/reporting goals unmet; the divergent surfaces keep producing new inconsistencies with every feature. **Rejected as an end state; its content is Phase 0 of A.**

---

## 10. Delivery phases

Each phase is independently shippable and rollback-able. No phase changes a route path or a database schema. Before any database-affecting work: run the operator health-check and backup per the Windows runbook (`windows/health-check.ps1`, `windows/backup-kapil.ps1`) and never touch an active SQLite file directly.

### Phase 0 — Safety net & verified defects
1. D2: backup snapshot covers all business collections + coverage readout.
2. D1: rename the summary boundary to gross `outstandingPaise` + explicit `netPositionPaise`; fix `computePurchaseLogMetrics`; re-label tiles; update tests to cover both.
3. D4: outgoing-only payment feed (or kind-labeled feed + retitled card).
4. D3: full Casting Logs edit schema (batches/coal/salary); lossless trash snapshot (batches + inputs).
5. D6: paginated Sales Logs via the shared shell; per-route document titles.
**Accept:** every defect has a red-then-green test (characterization first, then fixed behavior); `npm run verify` green; live pass on dashboard/logs/bills shows one consistent "we owe" story; backup page lists all collections.

### Phase 1 — Navigation, switches, Party Ledger
1. Sidebar reorder + renames (§4), URLs unchanged, active-state matching updated.
2. `purchaseEnabled` switch; Settings page; nav/command/quick-search gating; disabled-module history toggle with excluded-total notices (§6).
3. Party Ledger gains Suppliers scope (screen-level sharing only); Suppliers nav entry removed.
4. Mobile bottom nav gets Purchase.
**Accept:** all deep links unchanged; switching Purchase off hides its working views while history remains readable read-only; no console errors; 390px mobile pass.

### Phase 2 — Dashboards & AI Drafts
1. Home becomes the uncategorized company dashboard; Sales content moves to Sales Dashboard.
2. Purchase Dashboard purchase-scoped (casting figures gated).
3. AI Drafts shell made module-agnostic (sales drafts first).
**Accept:** Home shows all enabled modules; figures match per-module screens; drafts approve/reject flow unchanged for sales.

### Phase 3 — Reporting
1. Calendar + Company Report extended with Purchase/Casting sections and exclusion notices.
2. Module Reports page with Sales/Purchase/Casting tabs and shareable URLs.
**Accept:** shareable URL restores exact view; disabled-module sections carry the notice; export paths still work.

### Phase 4 — Setup & polish
1. Items administers all three catalogs (usage reporting preserved).
2. A11y + consistency sweep of the touched surfaces (labels, tabular figures, focus states).
**Accept:** `web-design-guidelines`-style pass clean; regression suite green.

---

## 11. Risks & mitigations

| Risk | Mitigation |
| :-- | :-- |
| Label renames confuse muscle memory / bookmarks | Routes unchanged; nav labels alongside unchanged icons; command bar keeps old aliases working for one release |
| D1 fix changes displayed numbers (net → gross or vice versa) | Owner signs off the per-surface presentation at spec time; both values shown where ambiguity matters; tests pin both |
| Shared Logs shell regresses Sales Logs (the polished module) | Sales Logs gets the shell behind identical filter/tab semantics; characterization tests on filters/focus params before migration |
| Casting edit-schema widening touches rarely-used code | D3 tests written against a seeded copy, never production data; trash-restore verified round-trip |
| Worktree currently carries a large uncommitted changeset from another agent | Implementation starts on a fresh branch/worktree from `06de703` or the owner's chosen base; this report's citations reference committed-state files and may shift against that changeset — re-verify line numbers at spec time |
| `/tmp` scratch artifacts (characterization tests, screenshots) lost to a machine restart during review | Findings above re-verified directly against source and live pages after the restart; Phase 0 regenerates the characterization tests in-repo where they belong |

---

## 12. Verification record (this review)

- Repo suite: **364 passed / 2 skipped**; `tsc --noEmit` clean; HEAD `06de703`.
- Source-verified: `purchase-log-metrics.ts`, `supplier-settlement.ts` (net position definition), `suppliers.ts:1226` (summary boundary), `backup.ts:26-30`, `casting.ts` (batches/coal/salary persistence), `casting/log.tsx:130-146` (flattened edit schema), `purchase-dashboard.tsx` (casting queries, unfiltered feed, we-owe sums), `recent-feeds.tsx`, `sidebar-nav.tsx`, `module-settings.ts`, `query-invalidation.ts:31` (audit-log invalidation now includes `purchase-logs-audit` — confirms the 11-07 audit's finding #9 is fixed).
- Live-verified (read-only, isolated browser profile, zero console errors): `/`, `/settings`, `/items`, `/ledger`, `/monthly-report`, `/monthly-sales-calendar`, `/transactions` (604 unpaginated rows), `/casting/log`, `/drafts`, `/purchase-dashboard`, `/purchase-logs`; desktop 1440px and mobile 390px emulation.
- No application changes, writes, or commits were made for this report.

## Appendix A · Status of the 2026-11-07 purchase audit findings

| # | Finding | Status at this review |
| :-- | :-- | :-- |
| 9 | Purchase writes don't invalidate the audit-log query | **Fixed** (`query-invalidation.ts:31`) |
| — | Supplier summary outstanding boundary | Superseded — now returns net position; renamed/re-presented as D1 in this report |
| Others | (bill status, settlement, ledger, chitty, entry regressions) | Addressed or folded into Purchase's ongoing development; not re-audited here — Phase 0's characterization tests will pin the ones that interact with integration surfaces |

*End of report.*
