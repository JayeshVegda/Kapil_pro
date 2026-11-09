# Kapil Billing — UI & Design System Conventions

> **Design Standard:** Measured against `/print-bill`, `/new-payment`, and `/new-purchase-bill`.  
> **Goal:** High density, consistent tactile feel, keyboard efficiency, and zero theme drift.

---

## 1. Visual Design Language & Tokens

### Surfaces & Elevation
- **Page Background:** Always `#f1f5f9` (Slate 100).
- **Standard Card / Container:** `rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5` (use `SectionCard` or `Panel`).
- **Nested Area:** `rounded-lg border border-slate-100 bg-slate-50 p-3`.
- **Empty State:** `rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center text-slate-500` (use `EmptyState`).

### Typography Scale (Geist Variable)
- **Modal / Hero Titles:** `text-base font-semibold text-slate-950`.
- **Page Sections, Cell Text, Body:** `text-sm text-slate-900`.
- **Labels, Table Headers, Form Descriptions:** `text-xs font-medium text-slate-600`.
- **References, Timestamps, Sub-labels:** `text-[11px] font-mono text-slate-400`.
- **Monetary & Quantities:** Monospace tabular figures: `font-mono tabular-nums`.
- **Banned Text Sizes:** `text-[9px]` and `text-[10px]` are strictly banned; the minimum allowable text size is `text-[11px]`.
- **Label Casing:** Always use Title Case for labels, form titles, and buttons. Never use UPPERCASE labels anywhere, except table column headers (`<th>`).

### Number Grouping & Date Formatting
- All currency amounts and weights must be formatted using Indian numerical grouping via helpers in `@/lib/inr-format` (`formatInrInteger`, `formatPaiseInr`, `formatInr`) — e.g. `₹1,23,456`.
- Business dates format via `@/lib/date` (`formatFullDate`, `getLocalIsoDate`).

### Icons & Accessible Interactions
- **Icon Sizing:** Lucide icons use `size={16}` in navigation rails, toolbars, and tab headers, and `size={14}` inside buttons.
- **Aria Labels:** Every icon-only button must have an explicit `aria-label` describing the action.
- **Dialog Keybindings:** All modals and dialogs must support keyboard shortcuts: `Esc` to close/cancel and `Ctrl+Enter` to submit/save.

---

## 2. Colour & Status Map

Colour is used sparingly and represents business state only:
- **`rose` (Red):** Reserved strictly for overdue balances, form validation errors, cancellations, and destructive confirmations. Never use red for normal amounts we owe.
- **`emerald` (Green):** Paid in full, advance credits, NIL balances, and positive financial receipts.
- **`amber` (Yellow/Orange):** Pending settlements, bardan pending, warnings, and attention items.
- **`slate` (Neutral):** Default text and surfaces. Amounts we owe to suppliers stay in neutral slate, not red.
- **`blue`:** Reserved strictly for selections, active navigation highlights, and informational tags. Never use blue for primary action buttons.
- **Pool Chips:** Kacha (`bg-amber-50 text-amber-800 border-amber-200`) and GST (`bg-blue-50 text-blue-700 border-blue-200`) or neutral slate badges.

---

## 3. Canonical Component Kit ("Need X $\to$ Use Y")

| UI Pattern Needed | Canonical Component / Helper | Import Path | Verified Classes / Props |
| :--- | :--- | :--- | :--- |
| **Buttons (All Variants)** | `buttonClass(variant)` | `@/components/ui/form-control-classes` | Primary: `bg-slate-900 text-white hover:bg-slate-800 px-3 py-2 text-sm font-medium rounded-md`<br>Secondary: `border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 text-sm rounded-md`<br>Danger: `bg-rose-600 text-white hover:bg-rose-500 px-3 py-2 text-sm rounded-md` |
| **Page Layout Container** | `PageShell` | `@/components/ui/business-kit` | Props: `toolbar`, `badge`, `actions`, `children` |
| **Standard Card Box** | `SectionCard` or `Panel` | `@/components/ui/business-kit` or `@/components/ui/panel` | Props: `title`, `subtitle`, `actions`, `children` |
| **Data Table with Paging** | `DataTable` | `@/components/ui/data-table` | Props: `data`, `columns`, `loading`, `error`, `empty`, `initialPageSize`, `selectable`, `footerTotals` |
| **Filter Bar (Search + Dates)** | `FilterBar` | `@/components/ui/business-kit` | Props: `search`, `onSearchChange`, `from`, `to`, `onFromChange`, `onToChange`, `chips`, `actions` |
| **Tabbed Selector / Toggle** | `TabBar` / `SegmentedToggle` | `@/components/ui/business-kit` | Props: `options`, `value`, `onChange`, `label` (`rounded-lg bg-slate-50 p-1`) |
| **Currency Display** | `MoneyCell` | `@/components/ui/money-cell` | Props: `amount`, `bold`, `align` (`'left' \| 'right'`) |
| **Status Badge / Pill** | `StatusChip` | `@/components/ui/status-chip` | Props: `status` (`'paid' \| 'pending' \| 'partial' \| 'draft' \| 'cancelled'`), `label` |
| **KPI Stat Tile** | `KpiCard` | `@/components/ui/business-kit` | Props: `label`, `value`, `subtext`, `delta`, `tone` (`'neutral' \| 'positive' \| 'warning'`), `icon`, `href` |
| **Empty State** | `EmptyState` | `@/components/ui/empty-state` | Props: `title`, `description`, `action` |
| **Delete / Discard Modal** | `ConfirmDialog` | `@/components/ui/confirm-dialog` | Props: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `tone`, `onConfirm`, `pending` |
| **Party / Item Autocomplete** | `SearchableCombobox` | `@/components/ui/searchable-combobox` | Keyboard-navigable accessible dropdown |
| **Date Picker** | `DateInput` | `@/components/ui/date-input` | Standard date input control |
| **Month Picker** | `MonthPicker` | `@/components/ui/business-kit` | Props: `value`, `onChange`, `label` |
| **Payment Amount Input** | `PaymentAmountInput` | `@/components/ui/payment-amount-input` | Specialized monetary input with paise handling |
| **Transaction Logs Shell** | `LogsPager`, `LogsDateWindow` | `@/components/logging/logs-shell` | 90-day time window pager |
| **Toast Notifications** | `toast` | `sonner` | Standard toast notification caller |

---

## 4. Banned Patterns List

1. ❌ **`window.confirm(...)`**: Banned. Always use `<ConfirmDialog>` with explicit title, description, and tone.
2. ❌ **`text-[9px]`, `text-[10px]`**: Banned. Minimum allowable text size is `text-[11px]`.
3. ❌ **`bg-blue-600` on buttons**: Banned. Primary buttons must use `bg-slate-900 text-white`.
4. ❌ **`focus:ring-blue-*` or `focus:ring-indigo-*`**: Banned. Focus rings must use the neutral slate contract `focus:ring-slate-400/30`.
5. ❌ **Raw `<h1>` inside page routes**: Banned. The top bar owns the page title. Use `<h2 className="text-sm font-semibold">` for section titles.
6. ❌ **Side Drawers or Slide-over panels**: Banned. Use centered dialogs for small interactions or dedicated full pages (`/purchase-bills/$billId`) for invoice viewing.
7. ❌ **Raw custom input styles**: Banned. Always use `inputClass` from `form-control-classes.ts`.
8. ❌ **UPPERCASE labels**: Banned. Title Case must be used everywhere except table column headers (`<th>`).

---

## 5. Developer Cookbook

### 5.1 Add a New List Page
```tsx
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageShell, SectionCard, FilterBar } from '@/components/ui/business-kit'
import { DataTable } from '@/components/ui/data-table'

type RowItem = { id: string; name: string }

const columns: ColumnDef<RowItem, unknown>[] = [
  { accessorKey: 'name', header: 'Item Name' },
]

export function MyListPage({ rows = [] }: { rows?: RowItem[] }) {
  const [search, setSearch] = useState('')
  return (
    <PageShell toolbar={<FilterBar search={search} onSearchChange={setSearch} />}>
      <SectionCard title="Master List" subtitle="Active catalog items">
        <DataTable data={rows} columns={columns} initialPageSize={25} />
      </SectionCard>
    </PageShell>
  )
}
```

### 5.2 Module Gating & Route Protection
The top-level root route `src/routes/__root.tsx` automatically protects all child routes using `isPathHiddenByModules(location.pathname, settings)` via `loadModuleSettingsForGuard()`.

For in-page subtab filtering (such as hiding tabs in `/items` or `/ledger`), use the shared hook:
```tsx
import { useModuleSettings } from '@/lib/use-module-settings'

export function MyComponent() {
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  // conditionally display Purchase or Casting tabs
}
```

### 5.3 Add a Database Collection (PocketBase Migration)
1. Always create a new file under `pb_migrations/` with a fresh, strictly increasing Unix timestamp:
   `pb_migrations/<timestamp>_created_my_collection.js`
2. Follow the modern PocketBase `fields` API (see real example in `pb_migrations/1794640004_created_app_settings.js`):
   ```javascript
   /// <reference path="../pb_data/types.d.ts" />
   migrate((app) => {
     // Enforce API rule convention for non-billing module collections:
     const restrictedRule = '@request.auth.id != "" && @request.auth.role != "muse"'
     const collection = new Collection({
       name: "my_collection",
       type: "base",
       system: false,
       listRule: restrictedRule,
       viewRule: restrictedRule,
       createRule: restrictedRule,
       updateRule: restrictedRule,
       deleteRule: restrictedRule,
       fields: [
         { name: "id", type: "text", system: true, primaryKey: true, required: true, min: 15, max: 15, pattern: "^[a-z0-9]+$", autogeneratePattern: "[a-z0-9]{15}" },
         { name: "name", type: "text", required: true, min: 1, max: 100 },
         { name: "active", type: "bool" },
         { name: "created", type: "autodate", onCreate: true, onUpdate: false },
         { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
       ],
       indexes: ["CREATE UNIQUE INDEX idx_my_collection_name ON my_collection (name)"]
     })
     app.save(collection)
   }, (app) => {
     app.delete(app.findCollectionByNameOrId("my_collection"))
   })
   ```
3. **NEVER edit or rename an applied migration.** Always append a new migration with a new timestamp.
