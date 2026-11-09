# Claude Developer Briefing

> **CRITICAL:** Read [**`AGENTS.md`**](file:///home/arch/project/Kapil_pro/AGENTS.md) first. It is the single source of truth for all business logic, invariants, and guidelines.

### Claude-Specific Workflow Tips
- **Verification Rule:** Always run `npm run verify` (`npm run typecheck && npm test && npm run build`) and `npx vitest run windows/windows-package.test.ts` before committing.
- **Safety Boundary:** Never modify, move, or rename applied migrations in `pb_migrations/`.
- **UI System:** Never handcraft raw forms, buttons, or modals; always follow [**`docs/ui/CONVENTIONS.md`**](file:///home/arch/project/Kapil_pro/docs/ui/CONVENTIONS.md) and import from `@/components/ui/form-control-classes`.
- **System Architecture:** Consult [**`docs/architecture/CURRENT-STATE.md`**](file:///home/arch/project/Kapil_pro/docs/architecture/CURRENT-STATE.md) for live routes and collections, and [**`docs/architecture/DECISIONS.md`**](file:///home/arch/project/Kapil_pro/docs/architecture/DECISIONS.md) for architectural rationale.
- **Historical Content:** Never read or copy patterns from `archive/` or `docs/archive/`.
