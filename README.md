# Kapil Billing

High-speed, single-operator desktop accounting and operations ERP built for a brass hardware manufacturer in Jamnagar, Gujarat.

The system encompasses three strictly decoupled operational modules:
1. **Sales Billing** — Outbound GST sales invoices, customer khata, and payment collections.
2. **Purchase / Procurement** — Inbound scrap intake, dual Kacha/GST supplier pools, and bag (bardan) tracking.
3. **Casting & Melting** — Foundry heats, melting loss %, wire output yields, and casting bills.

---

## 1. Production Architecture (Windows Local-Primary)

The production target is the factory Windows PC running native **PocketBase** (SQLite with WAL mode) and **Caddy**:
- **Caddy Web Server:** `http://127.0.0.1:4174`
- **PocketBase API:** `http://127.0.0.1:8090`
- **Writable Database:** `runtime/data/data.db` (Git-ignored)
- **Production Setup Runbook:** [WINDOWS-SETUP.md](WINDOWS-SETUP.md) · [DATABASE-RUNBOOK.md](DATABASE-RUNBOOK.md) · [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 2. Developer Commands

Development and testing run in Linux/macOS/Windows environments:

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev

# 3. Generate route tree (when editing src/routes/)
npm run router:generate

# 4. Verify everything (Typecheck + Vitest tests + Vite build)
npm run verify

# 5. Windows package test
cd windows && npx vitest run windows-package.test.ts
```

---

## 3. Documentation Index

For all development rules, architectural invariants, and conventions, see:

- [**`AGENTS.md`**](AGENTS.md) — **Single Source of Truth** for AI agents and developers. Contains invariants, business rules that must not drift, protected paths, and the "never do this" list.
- [**`CLAUDE.md`**](CLAUDE.md) — Concise command and workflow pointer for Claude Code.
- [**`docs/architecture/CURRENT-STATE.md`**](docs/architecture/CURRENT-STATE.md) — Verified live routes, collection schemas, data flows, and test tooling.
- [**`docs/architecture/DECISIONS.md`**](docs/architecture/DECISIONS.md) — Durable architectural decisions with one-line rationales.
- [**`docs/ui/CONVENTIONS.md`**](docs/ui/CONVENTIONS.md) — Design tokens, component catalog, colour/status map, and developer cookbook.
- [**`docs/README.md`**](docs/README.md) — Master registry of all documentation files.
