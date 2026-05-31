# Command K Gas Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Command K stock input and make bill and stock Command K suggestions gas-workflow aware with clear next-step guidance.

**Architecture:** Keep command parsing as the correctness boundary in `src/lib/commands.ts`. Add focused regression coverage around the Command K draft and item suggestion helpers in the app shell, then restore pending stock command consumption inside the rewritten stock workspace without reverting its current local changes.

**Tech Stack:** React 19, TypeScript, TanStack Router, TanStack Query, Vitest, PocketBase-backed item/customer data.

---

## File Map

- `src/components/layout/app-shell.tsx`: Command K suggestion filtering and live draft guidance.
- `src/components/layout/app-shell.test.ts`: focused helper-level Command K regression tests.
- `src/routes/stock-in.tsx`: consume pending Command K stock commands in the current stock workspace.
- `docs/superpowers/specs/2026-05-22-command-k-gas-guidance-design.md`: approved behavior design.

### Task 1: Command K Suggestions And Guidance

**Files:**
- Create: `src/components/layout/app-shell.test.ts`
- Modify: `src/components/layout/app-shell.tsx`

- [ ] **Step 1: Write failing suggestion tests**

```ts
it('suggests gas bill items and excludes electronic items', () => {
  const suggestions = buildCommandSuggestionsForTest('b Sambhu spi', customers, items)
  expect(suggestions.map((suggestion) => suggestion.label)).toContain('Spindle (8.5GM)')
  expect(suggestions.map((suggestion) => suggestion.label)).not.toContain('Electronic Part')
})
```

- [ ] **Step 2: Write failing draft guidance test**

```ts
it('guides the next bill token after an item is recognized', () => {
  const draft = buildCommandDraftForTest('b Sambhu spindle', customers, items)
  expect(draft?.suggestions).toContain('Add quantity in bags or kg')
  expect(draft?.suggestions).toContain('Optional: dr 80')
})
```

- [ ] **Step 3: Run focused tests and confirm they fail**

Run: `npm run test -- src/components/layout/app-shell.test.ts`

Expected: FAIL because test helpers and contextual guidance do not yet exist.

- [ ] **Step 4: Implement gas-only item suggestion helpers and bill draft guidance**

Filter command item suggestions through gas item type before ranked matching, preserve ranked query behavior for inputs such as `spi`, and export minimal test-only wrappers around existing pure helper functions.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run: `npm run test -- src/components/layout/app-shell.test.ts`

Expected: PASS.

### Task 2: Stock Command Handoff

**Files:**
- Modify: `src/routes/stock-in.tsx`

- [ ] **Step 1: Restore stock command hydration against current state names**

Use `PENDING_COMMAND_STORAGE_KEY` and `parseContextCommand` to parse pending stock commands after gas items and stock customers are ready, select the general stock customer, and fill the receive form state used by the rewritten stock workspace.

- [ ] **Step 2: Keep invalid pending payload cleanup**

Clear malformed, expired, or consumed pending storage entries so the same Command K stock command is not replayed later.

- [ ] **Step 3: Verify stock route compiles with the restored handoff**

Run: `npm run typecheck`

Expected: PASS.

### Task 3: Full Verification And Restart

**Files:**
- Verify changed project files

- [ ] **Step 1: Run the project tests**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Restart the Kapil Pro runtime**

Inspect the existing Compose service, restart the Kapil Pro stack with its checked-in Docker configuration, and confirm containers return healthy/running status.
