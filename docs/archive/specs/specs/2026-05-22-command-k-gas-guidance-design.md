# Command K Gas Guidance Design

## Goal

Make Kapil Pro Command K useful for the gas billing workflow by restoring stock command input on the current stock workspace, excluding electronic items from bill and stock item suggestions, and giving operators contextual next-step guidance while composing commands.

## Current Context

The Command K UI lives in `src/components/layout/app-shell.tsx` and delegates parsing to `src/lib/commands.ts`. Stock command parsing already rejects non-gas items, but item suggestions currently rank every item from the item master. The current local stock workspace rewrite removed the pending stock-command handoff that was present in the latest committed `src/routes/stock-in.tsx`, so Command K can store a stock command and navigate to `/stock` without the stock form applying it.

## Behavior

### Bill Commands

- Party suggestions remain the first step after a `b` prefix.
- Once a party is accepted and the item query starts, Command K suggests gas items only.
- Electronic item types are not suggested in bill command item suggestions.
- When a party or bill item is recognized, the live draft tells the operator what can come next:
  - item name when the party has no item yet
  - quantity in bags or kg after an item
  - optional default rate, final rate, GST, transport, and date tokens
- Item ranking keeps matching typed input such as `spi` ahead of generic guidance.

### Stock Commands

- Stock item suggestions use gas items only.
- `s <item> <qty> [date] ["note"]` continues to parse through the existing stock parser.
- A Command K stock command sent to `/stock` is consumed by the current stock workspace and fills the receive form again.
- Stock live guidance asks for quantity after a recognized item and keeps date and note as optional tokens.

## Implementation Shape

- Keep parsing validation in `src/lib/commands.ts`.
- Keep Command K presentation and contextual draft/suggestion behavior in `src/components/layout/app-shell.tsx`.
- Restore pending stock command consumption in the current `src/routes/stock-in.tsx` without undoing the ongoing stock workspace rewrite.
- Expose or isolate the smallest command suggestion/draft helpers needed for focused tests instead of browser-only coverage.

## Error Handling

- Parser errors remain the final guard before a command is applied.
- Restored stock handoff only consumes pending stock commands after stock items and stock customers are loaded.
- Expired or malformed pending stock command payloads are cleared as before.

## Verification

- Add regression tests for gas-only Command K item suggestions and next-step bill guidance.
- Keep stock parser validation coverage intact for gas-only stock commands.
- Run the focused tests first, then project test/typecheck/build verification.
- Restart the Kapil Pro runtime after verification so the user can inspect the live site.
