# Kapil Billing — UI & Design System Conventions

> **Design Standard:** Measured against `/print-bill`, `/new-payment`, and `/new-purchase-bill`.  
> **Goal:** High density, consistent tactile feel, keyboard efficiency, and zero theme drift.

---

## 1. Visual Design Language

### Surfaces & Elevation
- **Page Background:** Always `#f1f5f9` (Slate 100).
- **Standard Card / Container:** `rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5` (use `SectionCard` or `Panel`).
- **Nested Area:** `rounded-lg border border-slate-100 bg-slate-50 p-3`.
- **Empty State:** `rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center text-slate-500` (use `EmptyState`).

### Typography Scale (Geist Variable)
- **Modal / Hero Titles:** `text-base font-semibold text-slate-950`.
- **Page Sections, Cell Text, Body:** `text-sm text-slate-900`.
- **Labels, Table Headers, Form Descriptions:** `text-xs font-medium text-slate-500`.
- **References, Timestamps, Sub-labels:** `text-[11px] font-mono text-slate-400`.
- **Monetary & Quantities:** Monospace tabular numbers: `font-mono tabular-nums`.

### Buttons & Interactive Controls
- **Primary Action Button:** `inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50`.
- **Secondary Button:** `inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50`.
- **Danger Action:** `inline-flex h-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50`.
- **Segmented Toggle / Tabs:** Use `TabBar` from `@/components/ui/business-kit` (`rounded-lg bg-slate-50 p-1`).

### Form Controls
- Never handwrite input classes. Always import:
  ```ts
  import { inputClass, selectClass, textareaClass } from '@/components/ui/form-control-classes'
  ```
- Height: `h-9` standard (or `h-10` for primary monetary entry).
- Grey focus ring only: `focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30`.

### Tables at Scale
- Header: `sticky top-0 z-10 bg-slate-50 border-b border-slate-200`.
- Header Cells: `px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500`.
- Rows: `border-t border-slate-100 hover:bg-slate-50/70`.
- First column sticky: `sticky left-0 bg-white font-medium`.

### Hierarchy & Modals
- **No Duplicate Headers:** The top AppShell bar owns the page title. Never render a raw `<h1>` in route files.
- **No Side Drawers:** Slide-overs and drawers are banned. Use centered `Dialog` or `ConfirmDialog` modals.

---

## 2. Canonical Component Kit ("Need X $\to$ Use Y")

| UI Pattern Needed | Canonical Component | Import Path |
| :--- | :--- | :--- |
| **Page Layout Container** | `PageShell` | `@/components/ui/business-kit` |
| **Standard Card Box** | `SectionCard` or `Panel` | `@/components/ui/business-kit` or `@/components/ui/panel` |
| **Data Table with Paging** | `DataTable` | `@/components/ui/data-table` |
| **Filter Bar (Search + Dates)** | `FilterBar` | `@/components/ui/business-kit` |
| **Tabbed Selector / Toggle** | `TabBar` / `SegmentedToggle` | `@/components/ui/business-kit` |
| **Currency Display** | `MoneyCell` | `@/components/ui/money-cell` |
| **Status Badge / Pill** | `StatusChip` | `@/components/ui/status-chip` |
| **KPI Stat Tile** | `KpiCard` | `@/components/ui/business-kit` |
| **Empty State** | `EmptyState` | `@/components/ui/empty-state` |
| **Delete / Discard Modal** | `ConfirmDialog` | `@/components/ui/confirm-dialog` |
| **Party / Item Autocomplete** | `SearchableCombobox` | `@/components/ui/searchable-combobox` |
| **Date Picker** | `DateInput` | `@/components/ui/date-input` |
| **Month Picker** | `MonthPicker` | `@/components/ui/business-kit` |
| **Payment Amount Input** | `PaymentAmountInput` | `@/components/ui/payment-amount-input` |
| **Transaction Logs Shell** | `LogsPager`, `LogsDateWindow` | `@/components/logging/logs-shell` |
| **Toast Notifications** | `toast` | `sonner` |

---

## 3. Banned Patterns List

1. ❌ **`window.confirm(...)`**: Banned. Always use `<ConfirmDialog>` with explicit title, description, and tone.
2. ❌ **`text-[9px]`, `text-[10px]`**: Banned. The minimum allowable text size is `text-[11px]` (used for refs and secondary info).
3. ❌ **`bg-blue-600` on buttons**: Banned. Primary buttons must be `bg-slate-900 text-white`.
4. ❌ **`focus:ring-blue-*` or `focus:ring-indigo-*`**: Banned. Focus rings must use the neutral slate contract `focus:ring-slate-400/30`.
5. ❌ **Raw `<h1>` inside page routes**: Banned. The top bar owns the page title. Use `<h2 className="text-sm font-semibold">` for section titles.
6. ❌ **Side Drawers or Slide-over panels**: Banned. Use centered dialogs.
7. ❌ **Raw custom input styles**: Banned. Always use `inputClass` from `form-control-classes.ts`.

---

## 4. Developer Cookbook

### 4.1 Add a New List Page
```tsx
import { PageShell, SectionCard, FilterBar } from '@/components/ui/business-kit'
import { DataTable } from '@/components/ui/data-table'

export function MyListPage() {
  const [search, setSearch] = useState('')
  return (
    <PageShell toolbar={<FilterBar search={search} onSearchChange={setSearch} />}>
      <SectionCard title="Master List">
        <DataTable data={rows} columns={columns} />
      </SectionCard>
    </PageShell>
  )
}
```

### 4.2 Add a Route with Module Gating & Redirects
```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadModuleSettingsForGuard } from '@/data/module-settings'

export const Route = createFileRoute('/my-module/route')({
  beforeLoad: async () => {
    const settings = await loadModuleSettingsForGuard()
    if (!settings.purchaseEnabled) {
      throw redirect({ to: '/' })
    }
  },
  component: MyModulePage,
})
```

### 4.3 Add a Database Collection (PocketBase Migration)
1. Always create a new file under `pb_migrations/` with a strictly increasing Unix timestamp:
   `pb_migrations/<timestamp>_created_my_collection.js`
2. Follow the PocketBase migration schema:
   ```javascript
   migrate((app) => {
     const collection = new Collection({
       name: "my_collection",
       type: "base",
       schema: [
         { name: "name", type: "text", required: true },
         { name: "active", type: "bool" }
       ],
       indexes: ["CREATE UNIQUE INDEX `idx_name` ON `my_collection` (`name`)"]
     });
     app.save(collection);
   }, (app) => {
     const collection = app.findCollectionByNameOrId("my_collection");
     app.delete(collection);
   });
   ```
3. Never edit existing applied migrations.
