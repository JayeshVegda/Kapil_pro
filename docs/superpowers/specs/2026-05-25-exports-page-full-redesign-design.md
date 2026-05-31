# Exports Page Full Redesign Design

## Goal
Redesign the Kapil Pro Exports page so it feels like a focused business workflow, not a generic report utility.

Primary goals:
1. Make Party Statement Generator the clear first and main job of the page.
2. Use the visual language already established in Kapil Pro.
3. Remove useless or low-value UI from the Exports page.
4. Push non-primary exports into smaller secondary sections.
5. Remove Technical Tools from this page completely.

## Current problems
The current Exports page in [src/routes/export-reports.tsx](../../src/routes/export-reports.tsx) still has the wrong structure even after earlier cleanup.

### 1. It still feels like a report engine
The page still behaves like a multi-tool export console rather than a primary workflow page.

### 2. It does not match the stronger screens in the product
Compared with [src/routes/index.tsx](../../src/routes/index.tsx) and [src/routes/ledger.tsx](../../src/routes/ledger.tsx), the Exports page still feels flatter, more generic, and less intentional.

### 3. Too many equal-weight pieces compete for attention
The current page still gives too much visual weight to secondary export types, preview machinery, and leftover utility structure.

### 4. The main user goal is not visually dominant enough
The user wants the page to be centered around Party Statement generation, but the page still spreads attention across multiple report paths.

## Product direction
The Exports page should become a **Party Statement Generator page**.

This means:
- Party Statement is the main screen, always visible first.
- Other business exports become secondary tools below it.
- Technical backup/export tools are removed from this page.

## Page structure
The page should have three vertical sections.

### 1. Party Statement Generator
This is the hero section of the page.

It should include:
- party selector
- period selector
- summary metrics
- primary export action
- statement preview intro

This section should feel like the main workspace, using the same kind of strong card hierarchy used elsewhere in the app.

### 2. Statement Preview
This should sit directly below the generator and visually feel tied to it.

It should show:
- statement title/subtitle
- concise summary cards
- readable ledger preview table

The preview must look like the product of the generator, not a generic report table.

### 3. More Exports
This is a lower-priority section below the Party Statement flow.

It should include:
- Book Download
- Sales Register
- Stock Report

These should be presented as smaller, lighter blocks or cards so they do not compete with the main statement workflow.

## Removed from this page
The redesign should remove the following from the Exports page UI:
- Technical Tools section
- backup JSON controls
- raw CSV bundle controls
- left-side report picker
- any section whose main purpose is tool classification instead of helping the user export a statement
- duplicate explanatory cards that do not add decision value
- any generic report utility framing that weakens the Party Statement focus

If backup functionality still needs to exist in the codebase, it can live elsewhere, but it should not remain on this page.

## Visual direction
The page should reuse the project’s own design language instead of inventing a separate utility UI.

### Theme cues to reuse
From the dashboard and ledger pages:
- strong rounded section cards
- clear blue-highlight business panels where appropriate
- compact metric cards
- bordered white surfaces with dense but readable content
- practical business-first spacing and hierarchy

### Theme cues to avoid
- overly generic admin-panel layouts
- equal-weight boxes for everything
- side navigation inside the content area
- long blocks of helper copy
- visually flat export forms with no primary focal point

## Party Statement Generator design
This section should be restructured into two layers.

### A. Primary generator panel
Use one prominent top card that contains:
- title: Party Statement Generator
- short, practical instruction line
- party picker
- period picker
- optional custom date fields when needed
- primary PDF action
- secondary CSV action
- optional package download as tertiary action

The layout should feel more like a business action form than a report configuration panel.

### B. Quick summary strip
Below or alongside the controls, show 3-4 compact summary cards:
- Opening Balance
- Total Bills
- Total Payments
- Closing Balance

These should match the compact metric tone already used in the app.

## Statement Preview redesign
The preview should stop looking like a raw table first.

### Preview order
1. title/subtitle
2. summary strip
3. context line such as selected party and period
4. ledger table

### Ledger table behavior
The table should stay readable and tight:
- Date
- Entry
- Ref
- Debit
- Credit
- Running Balance

Avoid visually loud free-text columns in the main table.
If detail text is kept, it should be subordinate and muted.

### Empty state
If no party is selected, show one clean message in the preview area instead of a mostly empty export frame.

## More Exports section
The lower section should be clearly secondary.

### Book Download
Keep this because the user said it is mostly okay.
Make it a compact export block with:
- book selector
- small context text
- one main download button

### Sales Register
Keep it available but visually lower priority.
Do not let it dominate the page.

### Stock Report
Keep it available as a business export, but as a small secondary block.

### Layout style
These should be arranged as compact stacked cards or compact tiles that expand into their controls, whichever is simpler in the current codebase.
The key requirement is that they should look secondary to Party Statement.

## Code organization changes
The route file has still grown too large.
The redesign should include a focused UI split inside the Exports route area.

Recommended UI boundaries:
- Party Statement hero/generator section component
- Party Statement preview section component
- More Exports section component
- compact shared metric/panel helpers if needed

The exact filenames may vary, but the intent is:
- reduce the size of [src/routes/export-reports.tsx](../../src/routes/export-reports.tsx)
- isolate UI sections by responsibility
- keep Party Statement logic and presentation separate from lower-priority export blocks

## Data and export behavior
This redesign is primarily about UX and visual structure, but it must preserve the correctness improvements from the recent Party Statement pipeline split.

Required behavior:
- keep the dedicated Party Statement ledger model
- keep the dedicated Party Statement presenter
- keep the dedicated Party Statement PDF builder
- keep Book Download working
- keep Sales Register and Stock Report working if still visible

Removed UI should not accidentally revert the improved statement math or PDF flow.

## Testing strategy

### Logic verification
Keep the existing Party Statement ledger tests passing.

### UI verification
Verify:
- Party Statement Generator is the first visible export workflow
- Technical Tools are not visible
- More Exports is visually secondary
- Party Statement actions are clearer than before
- the page better matches dashboard/ledger visual hierarchy

### Manual product verification
Verify in the running app:
- page first impression is clearly statement-first
- no left-side report utility feeling remains
- Party Statement can still generate PDF and CSV
- Book Download still works
- Sales Register and Stock Report remain reachable if retained

## Expected result
After this redesign:
- the page feels like part of Kapil Pro, not a separate utility screen
- users land directly in Party Statement work
- secondary exports stop competing with the main use case
- the UI becomes cleaner, denser, and easier to trust
- technical/admin export clutter disappears from the Exports page
