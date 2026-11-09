# Kapil Billing: Declutter + Reorganize Plan (v3, declutter only)

Give this whole file to the coding agent. ONE STEP PER SESSION. This replaces the declutter steps in `kapil-declutter-and-dataviz-plan.md`. The chart/visualization steps (E, F there) are parked for later and are NOT part of this plan.

## How to start each session (change only the step number)

```
Read docs/features/kapil-declutter-reorg-plan.md completely. Implement ONLY Step N. Work on a feature branch, no master push, no live-DB or runtime changes. Use `git mv` for moves. Before deleting or moving anything, grep for references (src, scripts, windows, package.json, vite/vitest/tsconfig/eslint configs, index.html, *.md, tests). Run npm run verify and the Windows package test after each category and commit per category. Reply in max 10 lines: what changed, what you skipped and why, what to eyeball. Do not start the next step. If tokens run low, stop after a finished, verified commit.
```

## 1. The real problem

A new agent gets confused because the repo contains many true-looking but outdated things:
- old code (a full old project clone under `archive/demo/demo/`, stale redirect-only pages with hundreds of dead lines),
- old docs that describe a system that no longer exists (dropped Scrap Buying design, point-in-time audits written before the restructure, historical Muse and Cursor dumps),
- no single short document that says "this is how the app works now and how to build a page".

So the fix is not only deleting files. It has four parts:
1. **Quarantine the old** (delete or archive, plus ignore files so agents' search skips it).
2. **One source of truth** for agents (`AGENTS.md`), short, accurate and current.
3. **A UI conventions doc** (which kit component to use, banned patterns) plus an automated guard so new code cannot drift to a different theme.
4. **A small, dated docs set** instead of 40 overlapping files.

## 2. Corrections to the agent's `CODEBASE_DECLUTTER_GUIDE.md` (these win over the guide)

The guide is a good start but it is unverified in places. Re-verify every claim against the real files before acting.

| Guide says | Problem | Rule now |
|---|---|---|
| Casting items table is `casting_items`; migration `1794640006_created_casting_items.js` | Contradicts the repo tree and system map (`casting_materials`; migration `1794640006_items_active_and_casting_rules.js`) | Take names only from real files. Fix the guide where it is wrong. |
| Move `MUSE_*.md` to an archive | The owner's Muse agent may read these by path. They may be live instructions, not history. | Do NOT move or delete them. Ask the owner (Step 1). If they stay, add a header "Muse-facing, edit only when changing Muse behaviour". |
| Archive `apply-bill-number-guards.mjs`, `import-opening-balances.mjs`, `add-missing-indexes.mjs`, `ensure-*.mjs` as "historical" | README and runbooks reference some of these as live tools; Windows update scripts may call others | Archive a script only when grep shows ZERO references in `package.json`, `windows/`, tests, README, runbooks. Otherwise keep it where it is. |
| Move scripts to `scripts/historical/` | Moving breaks references | Prefer a `scripts/README.md` that labels each script (live / one-off / dev). Move only zero-reference one-offs. |
| Keep `system-map.md` and `ui-system-audit.md` as active docs | They are point-in-time snapshots from BEFORE the restructure (they still describe the old Customers page, side drawer, name-matching, etc.) and will mislead agents | Archive them. Replace with ONE current-state doc generated from the code (Step 4). |
| `archive/demo/demo/` "scanned by Vitest" | Possible, but unverified | Verify (`npx vitest list` or the vitest config). Exclude `archive/**` from vitest, tsc and eslint regardless. |
| Delete 9 zero-import `ui/*` files incl. `form-field`, `select`, `table`, `page-header`, `stat-tile` | The goal is a reusable kit. Deleting pieces we then re-create is waste. | Decide the canonical kit first (Step 5), then delete only duplicates and truly unused files, one category per commit. |
| Delete `cursor_project_scope_and_organization_d.md` | `README.md` links to it | Fix the README link in the same commit. |
| `.env.smoke` and `code.gs` "archive" | Smoke scripts may load `.env.smoke`; `automation/Sync-KapilToGoogleSheet.ps1` may use `code.gs` | Grep first. Keep if referenced. |
| `database-transfer/*.enc` | Production export inside the repo | Do not touch. Report whether it is tracked in git. |

## 3. Protected (never move, rename, edit or delete)

- `pb_migrations/` (renaming or moving an applied migration makes PocketBase re-apply it; two files share the `1794640004` prefix, leave both).
- `runtime/`, `database-transfer/`, `.env*`, `windows/`, `scripts/linux/`.
- `DATABASE-RUNBOOK.md`, `TROUBLESHOOTING.md`, `WINDOWS-SETUP.md`, `WINDOWS-LOCAL-HANDOFF.md` (edit links only).
- Sales and Purchase domain code (`src/domain/*`) and its tests.
- Redirect routes keep working (old bookmarks and Muse links): keep the redirect and its search-param mapping.
- Scripts referenced by `package.json`, `windows/*`, tests, README or runbooks.
- Confirm `.env`, `.env.smoke`, `runtime/state/*credentials*` are untracked or gitignored; if any is tracked, report it (do not delete).

## 4. Steps

### Step 1: Verify and decide (read-only, short)

Write `docs/operations/declutter-inventory.md` (max ~120 lines). No other file changes.
1. Run `npx knip` (temporary config; do not commit it). Cross-check the guide: for every guide item, mark CONFIRMED / WRONG / UNCERTAIN with the evidence (reference list).
2. Table: path | kind | references | action (delete / archive / keep / trim / ignore-only) | confidence.
3. Specifically report: whether vitest, tsc, eslint or knip scan `archive/**`; whether `.codeman-uploads/`, `.tanstack/`, `.impeccable/`, `.agents/` are tracked; whether `database-transfer/*.enc` is tracked; every file that references `MUSE_*.md`; every file that references `code.gs`, `.env.smoke`, `cursor_project_scope_and_organization_d.md`; each script's referrers; which docs in `docs/` and root contradict the current code (list each contradiction in one line, e.g. "describes Scrap Buying as dropped", "describes Customers page", "describes side drawer").
4. List the pending PocketBase migrations by comparing `pb_migrations/` against the `_migrations` table of a SCRATCH COPY of the data (never the live DB).
5. Reply with counts and the 5 riskiest items. Also list these owner questions: (a) do Muse agents read `MUSE_*.md` by path? (b) delete `archive/demo/demo/` (full old project clone, preserved in git history)? (c) delete or keep the `capture_*.mjs` and `audit-purchase-*.mjs` scratch scripts?

### Step 2: Quarantine the old (safe deletes and ignore files)

Only items the inventory marks high confidence.
1. Delete scratch and duplicate files: `.codeman-uploads/` (if untracked scratch), `codebase-tree.txt`, root `favicon.png` and `unfinished_favicon.png` (only if `public/` has the used favicon and `index.html` does not point at the root copies), the scratch scripts approved by the owner.
2. `archive/demo/demo/`: if the owner approved, delete it (git history keeps it). If not, keep it but exclude `archive/**` from vitest, tsc and eslint.
3. Exclude `archive/**` in `vite.config.ts` (vitest), `tsconfig*.json`, `eslint.config.js` either way.
4. Add agent-ignore files so searches skip old material: `.ignore` (read by ripgrep) and `.cursorignore` listing `archive/`, `docs/archive/`, `runtime/`, `database-transfer/`, `node_modules/`, `dist/`. Add `archive/README.md`: "Historical only. Do not read, import from, or copy patterns from here."
5. Verify: `npm run verify` (note the new test count; it may drop if archived tests no longer run, and explain the difference).

### Step 3: Reorganize docs

Target layout:
```
AGENTS.md                      canonical agent entry (Step 4)
CLAUDE.md                      short pointer to AGENTS.md plus Claude-only notes
README.md                      short, accurate human intro (Windows local-primary)
PRODUCT.md                     keep
docs/README.md                 index: every doc, one line, status (current / reference / archived)
docs/architecture/             CURRENT-STATE.md, DECISIONS.md (Step 4)
docs/ui/CONVENTIONS.md         (Step 4)
docs/operations/               runbooks, disaster recovery, deploy, audits that are still true
docs/features/                 ONLY active plans: the restructure plan/progress files may be folded into one dated history file
docs/archive/                  notes/, specs/, audits/, agent-work/   (ignored by agents)
```
1. `git mv` to `docs/archive/`: `AgentRouterWork/`, dated root notes (`update-*.md`, `PURCHASE-MODULE-AUDIT-AND-CHANGES.md`), `MUSE_SYNC_BRIEFING_2026-10-25.md`, `cursor_project_scope_and_organization_d.md`, `docs/superpowers/`, `system-map.md`, `ui-system-audit.md`, `billing-system-explained.md`, `procurement-casting-sales-workflow.md` (old Scrap Buying design), and the `*-page-notes.md` files, UNLESS the inventory shows they still describe current behaviour (then keep and mark current).
2. Do NOT move other `MUSE_*.md` files until the owner answers; add the Muse-facing header.
3. Fix every moved link (README, docs index, AGENTS/CLAUDE).
4. Rewrite `docs/README.md` as an index with a status column. Any doc left outside `docs/archive/` must be true today; if a doc is partly stale, correct it or archive it.

### Step 4: Write the canonical agent docs (the key step)

Write these from the real code (read it; do not copy the guide blindly). Date each file and keep them short.
1. **`AGENTS.md`** (canonical, under ~200 lines): what the app is; the 3 isolated modules and the isolation rule (separate items/party tables, no linking, no netting, no combined net figure); money rules (Sales rupee floats, Purchase integers: grams, paise, milli-rupees; never convert Purchase to floats); soft-delete and delete-protection rules; migration rules (new files only, never rename or edit applied ones; Windows PocketBase applies pending migrations on restart, so back up first); module toggles (`app_settings`, `ModuleGate`, route guards); Muse constraints (drafts only, no write access to live ledgers); verify commands; the Windows-production versus Linux-dev note; "do not read `archive/`, `docs/archive/`"; a "where things live" map (routes, data, domain, components, kit); a pointer to the other docs.
2. **`CLAUDE.md`**: 10-line pointer: "Read AGENTS.md first", plus Claude-only tips. No duplicated rules (they would drift).
3. **`docs/architecture/CURRENT-STATE.md`**: current routes and sidebar (with the redirect list), collections per module with key fields, data-flow per module in 5 lines each, module settings flow, test and tooling map. Generated from the code, dated.
4. **`docs/architecture/DECISIONS.md`**: one line per decision with the reason (isolation rule, integer money, Kacha/GST pools, FIFO plus manual pins, bardan methods, soft delete, tabs on Items and Party Ledger, logs window).
5. **`docs/ui/CONVENTIONS.md`**: the design language (page bg `#f1f5f9`, Geist, `rounded-xl border bg-white shadow-sm` cards, type scale, tables, inputs via `form-control-classes.ts`, dark slate primary buttons, state-only colour, top bar owns the title, no side drawers, centered dialogs); a table "need X -> use component Y" listing the real kit (`business-kit`, `DataTable`, `LogsShell`, `StatusChip`, `MoneyCell`, `Panel`, `EmptyState`, `ConfirmDialog`, `SearchableCombobox`, `DateInput`, `PaymentAmountInput`, ...); a "banned patterns" list; and a short cookbook: add a list page, add a form, add a route (with module gate and redirect rule), add a collection (migration rules).
6. Verify every file path and component name mentioned actually exists (`ls` / grep). Fix wrong names.

### Step 5: Prune dead code in `src/`

1. First write down the canonical kit (from CONVENTIONS.md). Components outside it that duplicate it are candidates; components inside it stay even if currently lightly used.
2. Delete only files and exports with zero references confirmed by grep AND knip, one category per commit: Vite template assets (`src/assets/*`), `components/modules/boilerplate-ui.tsx`, `components/layout/coming-soon-page.tsx` (if unused), unused `ui/*` files that duplicate the kit, unused exports, unused dependencies (`npm uninstall`, then verify).
3. Trim `src/routes/customers.tsx` and `src/routes/suppliers.tsx` to a minimal redirect (same target, same search-param mapping, still gated correctly). Do the same for any other redirect-only route that still holds a dead component body.
4. Delete the old purchase side drawer if still present and unreferenced.
5. Reply with files deleted, deps removed, and the bundle size before/after.

### Step 6: Guard against theme drift (small ratchet test)

1. Add `src/test/ui-conventions.test.ts`: scans `src/**/*.tsx` for banned patterns and compares counts with a committed baseline file (`src/test/ui-conventions.baseline.json`). The test fails if any count INCREASES, so existing violations are tolerated but no new ones can be added. Banned patterns: `window.confirm(`, `text-[9px]`, `text-[10px]`, `bg-blue-600` on buttons, `focus:ring-blue`, `focus:ring-indigo`, a raw `<h1` inside route files, `Drawer`/side-sheet imports.
2. Add a one-line mention in AGENTS.md and CONVENTIONS.md: "The conventions test must pass; lowering a baseline is encouraged."
3. Do not fix existing violations in this step.

### Step 7: Final verification and cold-start check

1. `npm run verify`, the Windows package test and `backup-kapil.test.ts`; confirm Vite builds; confirm `/dev/components` and the main routes still load (`scripts/smoke-ui.mjs`).
2. List the pending migrations and the owner steps: run `windows\backup-kapil.ps1`, restart with `stop-kapil.ps1` / `start-kapil.ps1`, check `/issues` and `/data-health`.
3. Print the final repo tree to depth 2 and the root file list.
4. **Cold-start test for the owner**: open a brand-new agent session and ask these three questions; the answers should come straight from AGENTS.md and the docs without reading old files: (a) "Where do I add a new Purchase list page and which components should it use?" (b) "How do items work across Sales, Purchase and Casting?" (c) "What button and colour style do we use, and what is banned?" If any answer is wrong, fix the doc, not the agent.
5. Final reply (max 12 lines): counts removed or archived, docs layout, the migration steps, open owner decisions.

## 5. Rules for every step

- Feature branch only; no master push; no live-runtime or live-DB access; scratch copies only.
- `git mv` for moves; one commit per category; revertable.
- When unsure: archive, do not delete; when still unsure: leave and report.
- Never change Sales or Purchase math or any `src/domain` test in this plan.
