# Exports Redesign Design

## Goal
Improve the Kapil Pro Exports area so it feels trustworthy, business-friendly, and easy to use.

Primary goals:
1. Make Party Statement the main export product.
2. Improve PDF readability and structure.
3. Fix the underlying statement data flow so balances, ordering, and totals are reliable.
4. Simplify the page so users can immediately understand what to export.

Non-goals:
- Do not redesign Book Download from scratch.
- Do not invest heavily in Sales Register right now.
- Do not keep Outstanding in the business export surface.

## Current problems
Current behavior is concentrated in [src/routes/export-reports.tsx](../../src/routes/export-reports.tsx), which mixes:
- business-facing exports
- technical backup tools
- preview rendering
- statement assembly
- PDF generation
- ZIP packaging
- bill JPG/PDF generation
- workbook generation

This creates three user-visible problems:

### 1. The page feels overloaded
The current report picker mixes Party Statement, Sales Register, Stock Report, Outstanding, Book Download, and Technical Backup in one list. Users must understand internal report types before they can decide what to export.

### 2. Party Statement feels unreliable
The current Party Statement builder combines ledger math, ordering, filtering, and presentation in one function. That makes it hard to verify correctness and easy for display problems to look like data problems.

### 3. PDFs are readable enough to generate but not easy to trust
The current PDF output uses a generic report table pattern. It is serviceable for raw exports, but not ideal for a business statement that should be shared and understood quickly.

## Product direction
The Exports area should be split into two top-level sections:

1. **Business Exports**
2. **Technical Exports**

This makes the page easier to scan and separates customer-facing documents from admin/safety exports.

## Information architecture

### Business Exports
This section should contain:
- Party Statement — primary/default
- Book Download — secondary
- Sales Register — optional lower-priority item

This section should not contain:
- Outstanding
- Backup JSON
- Raw CSV bundle

### Technical Exports
This section should contain:
- Full Backup JSON
- Raw CSV Bundle

This section should be visually labeled as admin/technical so it is not confused with shareable business reports.

## Party Statement redesign

### Primary user outcome
A user should be able to select a party and date range, review a clean summary, and export a PDF that is easy to read and easy to trust.

### Statement format
The Party Statement PDF should become a business-friendly statement with three layers.

#### A. Header
Show:
- Party name
- Date range
- Generated date/time
- Company name

#### B. Summary strip
Show four summary blocks:
- Opening Balance
- Total Bills
- Total Payments
- Closing Balance

These values should be large, simple, and visually stable.

#### C. Ledger table
Use a simplified table with these columns:
- Date
- Entry
- Ref
- Debit
- Credit
- Running Balance

Do not keep a noisy always-wide Details column in the main table.

### Detail handling
Bill item details should not dominate the core ledger.

Recommended behavior:
- Keep the main ledger concise.
- Show short secondary detail text only when it materially helps understanding.
- If bill-item detail is needed, place it as a smaller sub-row or appendix-style detail section later.

For the first pass, the statement should optimize for clarity over exhaustiveness.

## Data model redesign for trust
The Party Statement logic should be refactored so correctness is easier to reason about than it is today.

### Current issue
The current implementation in [src/routes/export-reports.tsx](../../src/routes/export-reports.tsx) builds output rows while also calculating opening balance, filtering in-range rows, and formatting details. That increases the chance of ordering ambiguity and balance confusion.

### Proposed model
Introduce a dedicated statement-building pipeline:

1. **Normalize ledger events**
   - Convert bills and payments into a shared ledger-event shape.
   - Each event should have: date, type, ref, debit, credit, and stable sort metadata.

2. **Sort deterministically**
   - Sort by date first.
   - Apply explicit event-type tie-breaking when bill and payment share the same date.
   - Apply record-level tie-breakers so the same dataset always produces the same ledger order.

3. **Compute opening balance once**
   - Start from customer opening balance.
   - Apply all pre-range events to compute the real opening ledger position.

4. **Build the in-range running ledger**
   - Use the already-sorted normalized events.
   - Apply each row exactly once to derive the running balance.

5. **Derive presentation models from the trusted ledger**
   - Summary totals
   - PDF table rows
   - CSV rows
   - On-screen preview rows

This separation makes it easier to verify the numbers independently from the UI and PDF layout.

## UX redesign

### Overall page layout
The page should stop feeling like one giant control panel.

Recommended structure:
- Page title and short description
- Two top-level sections: Business Exports and Technical Exports
- Within Business Exports, use prominent cards or segmented choices
- Default selection should land on Party Statement

### Party Statement controls
Keep the controls minimal:
- Party selector
- Period selector
- Optional custom range when needed

Primary action:
- Download Statement PDF

Secondary actions:
- Download CSV
- Download ZIP package, visually separated from the main PDF action

### Preview behavior
The on-screen preview for Party Statement should be closer to the final document:
- Summary cards first
- Clean ledger preview below
- Less generic table framing
- Less noise from secondary fields

The preview should help users build trust before export, not just show raw rows.

### Book Download behavior
Book Download remains available but should receive only modest polish:
- clearer wording
- cleaner spacing
- keep the existing ZIP workflow
- continue showing bill count and date range

### Outstanding behavior
Remove Outstanding from the Exports interface.

Rationale:
- The user does not need it.
- It adds cognitive load.
- It dilutes the focus of the page.

If the underlying logic remains useful, it can stay internal for now, but it should not remain a visible business export in this redesign.

## PDF design direction
The current generic table export from [src/routes/export-reports.tsx](../../src/routes/export-reports.tsx) should be adapted into a clearer statement layout.

### PDF principles
- Prioritize readability over density.
- Keep numeric columns aligned and visually consistent.
- Avoid wide, noisy rows.
- Use summary information to orient the reader before the ledger starts.
- Make page breaks feel intentional.

### Specific improvements
- Slightly stronger visual hierarchy in the header
- Cleaner spacing between summary and ledger
- More deliberate column widths for debit/credit/balance
- Reduced dependence on long free-text detail cells
- Consistent formatting for dates and currency

## Component and code organization
The current route file is too responsible for too many export concerns.

Recommended restructuring:

### Keep in route
- selected report state
- user filters
- section switching
- action wiring

### Move out of route
- party statement ledger builder
- PDF view-model assembly
- export-specific row formatting
- business export config metadata

Suggested new boundaries:
- `src/lib/exports/statement-ledger.ts`
- `src/lib/exports/statement-presenter.ts`
- `src/lib/exports/report-pdf.ts`
- optional UI subcomponents for business/technical export sections

Exact filenames can change, but the design intent is to separate:
- data correctness
- presentation shaping
- UI rendering

## Testing strategy
This work needs logic verification, not only UI verification.

### Unit-level coverage
Add focused tests for Party Statement ledger building:
- opening balance calculation
- same-day ordering
- running balance progression
- closing balance correctness
- period filtering
- zero/empty edge cases

### UI verification
Verify:
- Party Statement is the default focus
- Business and Technical sections are clearly separate
- Outstanding no longer appears
- preview text matches selected party and date range

### Export verification
Verify manually:
- generated Party Statement PDF is readable
- totals in summary match ledger rows
- CSV uses the same trusted ledger values
- Book Download still works after page restructuring

## Rollout order
Recommended implementation order:

1. Refactor Party Statement data pipeline for correctness.
2. Redesign Party Statement PDF structure.
3. Redesign Business vs Technical page layout.
4. Remove Outstanding from visible exports.
5. Lightly polish Book Download.
6. Leave Sales Register as low-priority cleanup.

## Expected result
After this redesign:
- users understand the page faster
- Party Statement becomes the clearly trusted core export
- PDFs read like business documents instead of raw report dumps
- data issues become easier to diagnose and less likely to recur
- technical backup tools remain available without cluttering the main export flow