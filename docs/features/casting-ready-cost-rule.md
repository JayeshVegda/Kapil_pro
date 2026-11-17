# Casting ready cost rule

Applies to new Casting sessions (`cost_formula_version = 2`). All terms are rupees per kg.

| Term | Calculation |
| --- | --- |
| A, metal | Total input material cost ÷ total input kg (existing rule) |
| Chitty Brass rate | Total amount of Casting input lines named `Brass` ÷ their total kg; this is the displayed Brass line rate on the chitty, never the market rate |
| B, Baravo | Chitty Brass rate × 0.07 × 2 |
| C, furnace and worker | 2 × (coal kg × coal rate ÷ wire-out kg) + 2 × (worker wages ÷ wire-out kg) |
| Final ready cost | A + B + C |

If there is no `Brass` input line, the chitty Brass rate and Baravo are zero. The chitty shows the missing Brass rate as `—` and the Baravo amount as zero. Other Casting material names are not matched to Purchase or Sales items.

## History

Existing sessions have no `cost_formula_version` value and are read as version 1. Their Baravo stays at 7.5% of average metal cost; coal and worker are doubled as before. Editing a version 1 session retains that formula and its existing coal and wage inputs. Restoring a session from temporary trash carries its formula version. The migration adds only the version field and does not rewrite old rows. Both on-screen and printed chitties display the saved session's versioned cost.

The calculation lives in `src/domain/casting-calculations.ts`. New session preview uses version 2. Save, edit, read, and restore paths use the session version through `src/data/casting.ts` and `src/routes/casting/log.tsx`.
