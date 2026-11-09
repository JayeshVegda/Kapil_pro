# Claude Developer Briefing

> **CRITICAL:** Read [**`AGENTS.md`**](AGENTS.md) first. It is the single source of truth for all business logic, invariants, and guidelines.

### Claude-Specific Workflow Tips
- **Verification Rule:** Always run `npm run verify` (`npm run typecheck && npm test && npm run build`) and `cd windows && npx vitest run windows-package.test.ts` before committing.
- **Safety Boundary:** Never modify, move, or rename applied migrations in `pb_migrations/`. Never run tests or seeds against `runtime/data/data.db`.
- **UI System:** Never handcraft raw forms, buttons, or modals; always follow [**`docs/ui/CONVENTIONS.md`**](docs/ui/CONVENTIONS.md) and import from `@/components/ui/form-control-classes`.
- **System Architecture:** Consult [**`docs/architecture/CURRENT-STATE.md`**](docs/architecture/CURRENT-STATE.md) for live routes and collections, and [**`docs/architecture/DECISIONS.md`**](docs/architecture/DECISIONS.md) for architectural rationale.
- **Historical Content:** Never read or copy patterns from `archive/` or `docs/archive/`.
