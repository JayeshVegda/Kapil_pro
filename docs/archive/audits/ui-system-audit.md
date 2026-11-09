# UI/UX & Component System Audit — Kapil Billing

## 1. Token Audit
| Token Group | Defined In | Bypassed By Raw Values (Count & Examples) |
| :--- | :--- | :--- |
| **Colors** | `src/index.css` (`:root`, `@theme inline`) | `rose-*` (180+ vs red), `amber-*` (160+ vs yellow), `indigo-*` (28 in drafts), `green-*` (4 vs emerald) |
| **Radii** | `src/index.css` (`--radius: 0.5rem`) | `rounded-md` (304), `rounded-lg` (244), `rounded-xl` (178), `rounded` (154), `rounded-2xl` (4) |
| **Shadows** | `src/index.css` (Tailwind standard) | `shadow-sm` (215), `shadow-xs` (70), `shadow-2xl` (21), `shadow-none` (5), `shadow-md` (4) |
| **Inputs** | 3 fragmented inline strings | `slate-500` ring (`new-bill.tsx:2237`, 8x), `blue-400` ring (`customers.tsx:235`, 10x), `ring/30` (`items.tsx:118`, 4x), `indigo` (`drafts.tsx:234`) |
| **Fonts** | `src/index.css` (`Geist Variable`) | Arbitrary sizes: `text-[10px]` (236), `text-[11px]` (226), `text-[9px]` (26), `text-[13px]` (7), `text-[8px]` (3) |

**Top 15 Raw Deviations:**
1. `text-[10px]` (236) | 2. `text-[11px]` (226) | 3. `rounded-md` (304) | 4. `rounded` (154) | 5. `text-rose-600`/`bg-rose-50` (121) | 6. `bg-amber-50`/`text-amber-700` (112) | 7. `shadow-xs`/`shadow-2xs` (74) | 8. `focus:ring-blue-100`/`focus:border-blue-400` (22) | 9. `focus:ring-indigo-500` (14) | 10. `text-green-700` (4) | 11. `text-[9px]` (26) | 12. `text-[13px]` (7) | 13. `border-indigo-500` (6) | 14. `shadow-2xl` (21) | 15. `h-8` inputs (in `purchases-shell.tsx:126`)

## 2. Component Inventory
| Component | File Path | Props Summary | Used Count | Modules |
| :--- | :--- | :--- | :---: | :--- |
| `AppShell` | `src/components/layout/app-shell.tsx` | `{ children }` | 1 | Global shell |
| `SidebarNavPanel` / `MobileBottomNav` | `src/components/layout/sidebar-nav.tsx` | `{ mobileOpen, onMobileClose }` / `{ onMore }` | 1 | AppShell |
| `QuickSearchPreview` | `src/components/layout/quick-search-preview.tsx`| `{ result, onSelect }` | 1 | AppShell |
| `PurchasesShell` | `src/components/suppliers/purchases-shell.tsx` | `{ currentTab, totalCount, children }` | 4 | Purchase |
| `SearchableCombobox` | `src/components/ui/searchable-combobox.tsx` | `{ options, value, onChange, placeholder }` | 6 | Sales, Purchase, Casting |
| `DateInput` | `src/components/ui/date-input.tsx` | `{ value, onChange, className, placeholder }` | 9 | Sales, Purchase, Customers |
| `PaymentAmountInput` | `src/components/ui/payment-amount-input.tsx` | `{ value, onChange, max }` | 6 | Sales, Purchase |
| `RowMenu` | `src/components/ui/row-menu.tsx` | `{ items }` | 2 | Purchase, Ledger |
| `ConfirmDialog` | `src/components/ui/confirm-dialog.tsx` | `{ open, title, description, onConfirm, onCancel }` | 3 | Purchase, Items |
| `Panel` | `src/components/ui/panel.tsx` | `{ children, className }` | 5 | Purchase |
| `EmptyState` | `src/components/ui/empty-state.tsx` | `{ title, description, action }` | 1 | Purchase |
| `PurchaseBillsTable` / `PaymentsTable`| `src/components/suppliers/purchase-bills-table.tsx`| `{ bills, onOpen, onCancel }` / `{ payments, onView }` | 4 | Purchase |
| `BillChitty` | `src/components/suppliers/bill-chitty.tsx` | `{ bill, onPrint, onEdit }` | 2 | Purchase |
| `BillDetailDrawer` | `src/components/suppliers/bill-detail-drawer.tsx` | `{ billId, open, onClose }` | 1 | Purchase (side drawer) |
| `SupplierFormModal` / `BillModals` | `src/components/suppliers/{supplier-form-modal,bill-modals}.tsx`| `{ open, onClose, onSave, onConfirm }` | 5 | Purchase |
| Trend Charts (3) | `src/components/reports/company-charts.tsx` | `{ data }` (Sales/Collections, Purchases/Paid, Party) | 3 | Sales, Purchase, Ledger |
| `Sonner` (`Toaster`) | `src/components/ui/sonner.tsx` | `{ ...props }` | 1 | Root |
| *Unused Primitives* | `src/components/ui/{button, table, form-field, input, select, stat-tile, page-header}.tsx` | Standard wrappers | **0** | Dead code / unintegrated |

## 3. Duplication Map
| Pattern | Existing Variants Across Modules | Best Version to Promote |
| :--- | :--- | :--- |
| **Page Header + Toolbar** | `new-bill.tsx:169`, `transactions.tsx:325`, `purchases-shell.tsx:50`, `items.tsx:150` | `PurchasesShell` / unified `PageShell` (title, count badge, action bar) |
| **Data Table** | `transactions.tsx:365`, `casting/log.tsx:470`, `purchase-bills-table.tsx:150`, `ledger.tsx:610` | `src/components/suppliers/purchase-bills-table.tsx` (sticky header, sticky col, footer) |
| **Filter Bar** | `transactions.tsx:325` (inline), `purchase-logs.tsx:340` (pills+search), `ledger.tsx:590` | `src/routes/purchase-logs.tsx` (pills + search + dates + CSV button) |
| **Pagination** | `ledger.tsx:658` (prev/next/page indicator), `drafts.tsx:590`; **missing** in logs & bills | `src/routes/ledger.tsx:658` (Showing X-Y of Z, prev/next buttons) |
| **KPI Card** | `index.tsx:280` (`MonthStat`), `casting/materials.tsx:135` (`Metric`), `snapshot-tiles.tsx:30` | `src/components/purchase-dashboard/snapshot-tiles.tsx` (icon, label, delta, tone) |
| **Status / Pool Chip** | `business-dashboard.tsx:24` (`StatusPill`), `purchase-bills-table.tsx:80` (custom spans) | Promote unified `StatusChip` with standard color map (emerald/amber/rose/slate) |
| **Money Cell** | `formatInrInteger` in `ledger.tsx`, `formatPaiseInr` in `purchase-bills-table.tsx` | Promote `MoneyCell` with `font-mono tabular-nums`, Indian comma grouping |
| **Modal Shell** | `dialog.tsx`, `confirm-dialog.tsx`, `bill-modals.tsx:ModalShell`, `transactions.tsx` | `src/components/ui/confirm-dialog.tsx` + Radix `Dialog` (centered, Esc/Enter, a11y) |
| **Tab Bar** | `purchases-shell.tsx:65`, `items.tsx:170`, `supplier-ledger.$supplierId.tsx:550` | `PurchasesShell` tab strip (clean segmented pill/underline) |
| **Form Field + Error** | Hand-rolled `<label>` + `<span>` in `new-bill.tsx`, `casting/log.tsx`, `supplier-form-modal.tsx` | `src/components/ui/form-field.tsx` (standard label, error text, required star) |
| **Empty State** | Text in `transactions.tsx:430`, `empty-state.tsx:1` (dashed box) | `src/components/ui/empty-state.tsx` (dashed slate-300 on slate-50 + icon + CTA) |
| **Loading Skeleton** | Pulse grid in `index.tsx:75`, text in `ledger.tsx:624`, text in `casting/materials.tsx:42` | `src/routes/index.tsx:75` pulse cards/rows |
| **Confirm Dialog** | Radix `confirm-dialog.tsx` vs raw `window.confirm` / bespoke modals in `transactions.tsx` | `src/components/ui/confirm-dialog.tsx` |
| **JPG / Print Export** | `bill-print-export.tsx`, `image-export.ts` (`exportNodeAsJpg`), `ledger.tsx:907` | `src/lib/image-export.ts` (`exportNodeAsJpgBlob` with offscreen DOM) |
| **Ledger Row** | `ledger.tsx:630` (customer), `supplier-ledger.$supplierId.tsx:720` (supplier) | `src/routes/ledger.tsx:630` layout (Date, Type, Ref, Debit, Credit, Balance) |

## 4. Tables at Scale
| Table | Loaded Rows | Filter / Sort / Page | Virtualized? | Query Key & Cache | Est. 5k Rows | Est. 20k Rows | Major Bottleneck |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Sales Bills** | All (`getFullList`) | Client memo | No | `['bills']` (staleTime: 0) | 1.5s load, 25MB DOM | 6s+ load, browser lag | All line items loaded in memory |
| **Sales Logs** | All (`getFullList`) | Client memo | No | `['transactions-page']` (60s poll) | 3s load, DOM freeze | 12s+ crash, ~80k DOM nodes | Entire bill & payment tree in single DOM |
| **Purchase Bills** | All (`getFullList`) | Client memo | No | `['purchase-bills']` (30s stale) | 2s load, laggy sort | 8s load, 40MB heap | Full lines + bardan arrays joined in client |
| **Purchase Payments**| All (`getFullList`) | Client memo | No | `['supplier-payments']` (30s stale) | 1s load, fine | 4s load, laggy search | Reallocating allocations in memory |
| **Ledgers** | Customer/supplier all | Client memo (paged: 20) | No | `['party-statement']` (stale: 0) | Fast display (paged) | Fast display, slow fetch | Full event list rebuilt from all bills |

**5 Highest-Impact Performance Fixes (Ranked):**
1. **Server-side windowing/pagination in PocketBase queries**: Replace `getFullList()` with `getList(page, 50, { filter: 'date >= ...' })` in `src/data/transactions.ts` and `src/data/suppliers.ts`.
2. **DOM Virtualization (`@tanstack/react-virtual`)**: Apply to `TransactionsPage` (`transactions.tsx`) and `PurchaseLogsPage` (`purchase-logs.tsx`).
3. **Query Projections (`fields` param)**: Omit line items, photos, and private notes from table list queries.
4. **Cache Running Party Balances**: Store incremental balance in `suppliers` and `customers` to avoid client-side FIFO replay of all historical bills on load.
5. **Universal Client Pagination Fallback**: Immediately enforce `pageSize = 25` with pagination controls on all 5 tables.

## 5. Consistency Gaps
| Consistency Gap | Example A (Sales / Reference) | Example B (Purchase / Casting / Setup) | Files |
| :--- | :--- | :--- | :--- |
| **Title / H1 Duplication** | AppShell `<header>` owns title (`app-shell.tsx:717`) | In-page duplicate `<h1>` titles | `items.tsx:157`, `export-reports.tsx:551`, `supplier-ledger.$supplierId.tsx:459` |
| **Button Styles** | `bg-slate-900 text-white hover:bg-slate-800` | `bg-blue-600 text-white` or `bg-primary` | `new-bill.tsx:178` vs `casting/log.tsx:450`, `purchase-logs.tsx:476` |
| **Status / Money Tones** | Overdue = `rose-600`, Clear = `emerald-600` | Overdue = `red-700` or `amber-700`, Clear = `green-700` | `index.tsx:186` vs `purchase-bills-table.tsx:82` |
| **Table Row Heights** | Compact `py-2` (~36px height) | Tall `py-3` to `py-3.5` (~48px height) | `transactions.tsx:370` vs `items.tsx:615`, `purchase-logs.tsx:510` |
| **Date Formatting** | `formatFullDate` (`15 Sep 2026`) | Raw `YYYY-MM-DD` or `formatDateTime` | `ledger.tsx:635` vs `purchase-bills-table.tsx:210`, `casting/log.tsx:480` |
| **Number / Currency** | `formatInrInteger` (`₹2,00,000`) | `formatPaiseInr` with decimals (`₹671.567/kg`) | `new-payment.tsx:720` vs `new-purchase-bill.tsx:310` |
| **Label Casing** | Title Case (`Sales Payment`, `Party Ledger`) | UPPERCASE (`KACHA POOL`, `MATERIAL ITEMS`) | `app-shell.tsx:30` vs `new-purchase-bill.tsx:220` |
| **Icon Sizes** | Uniform `size={16}` (sidebar/toolbar), `size={14}` (buttons) | Mixed `size={13}`, `size={15}`, `size={18}` | `sidebar-nav.tsx:170` vs `purchase-logs.tsx:479`, `index.tsx:248` |
| **Container Padding** | Standard `p-5 shadow-sm rounded-xl` | Inconsistent `p-3`, `p-4`, `p-6` | `new-bill.tsx:1480` vs `purchase-dashboard.tsx:40` |
| **Modal vs Drawer** | Centered Radix Modals (`bill-modals.tsx`) | Slide-over side drawer (`BillDetailDrawer`) | `confirm-dialog.tsx` vs `src/components/suppliers/bill-detail-drawer.tsx` |
| **Mobile Behaviour** | Responsive flex-wrap & bottom nav clearance | Overflowing min-widths without horizontal scroll | `print-bill.tsx` vs `casting/log.tsx:470` |

## 6. Responsive & Accessibility
**Worst 8 Identified Problems:**
1. **Side Sheet Cramping on Laptops**: `BillDetailDrawer` (`bill-detail-drawer.tsx`) squeezes tables into unreadable slivers on 1366px screens without proper backdrop focus trapping.
2. **Missing Table Scroll Wrappers**: Several tables lack `overflow-x-auto` or `min-w-[700px]`, squashing column headers into blank 14px bars on laptop screens (`new-purchase-bill.tsx`, `casting/log.tsx`).
3. **Missing `aria-label` on Icon Buttons**: Edit, trash, and expand icon-only `<button>` tags throughout `transactions.tsx`, `casting/log.tsx`, and `items.tsx` lack accessibility labels.
4. **Custom Modals Missing Escape/Trap Keys**: Handcrafted fixed overlay divs in `casting/log.tsx` do not dismiss on `Escape` or trap tab focus.
5. **Low Contrast on Status Chips**: `text-amber-700 bg-amber-50` and `text-slate-400 bg-slate-100` on white card surfaces fail WCAG AA 4.5:1 ratio for small text (`text-[10px]`).
6. **Layout Shift / Jitter on Currency**: Missing `tabular-nums` in Casting and Purchase money cells causes table column widths to jitter during data changes.
7. **Inconsistent Focus Rings**: Four divergent focus outlines (`ring-blue-100`, `ring-slate-400/30`, `ring-indigo-500`, none) confuse keyboard users.
8. **Mobile Bottom Nav Clipped Content**: Missing bottom padding (`pb-[max(...)]`) on some routes causes mobile buttons to cover the last table rows.

## 7. States Audit
| Page / Module | Loading State | Empty State | Error State | Offline / Sync State | Module Disabled Guard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sales** (`/new-bill`, `/transactions`) | Text `<p>Loading...</p>` | Plain center text | Red banner or silent | Top-bar sync status indicator | N/A (Core module) |
| **Purchase** (`/purchase-*`, `/suppliers`)| `animate-pulse` skeletons | Ad-hoc text | Red alert banner | Top-bar sync status indicator | **Missing** (no setting or guard) |
| **Casting** (`/casting/*`) | Text `<p>Loading...</p>` | Ad-hoc text | Red alert banner | Top-bar sync status indicator | Sidebar hidden; **direct URL unguarded** |
| **Ledger** (`/ledger`) | Table row skeleton/text | Plain center text | Red error toast | Top-bar sync status indicator | N/A |
| **Items** (`/items`) | Table spinner/text | Dash placeholder | Toast error | Top-bar sync status indicator | **Missing** (tabs unguarded) |

## 8. Proposed Unified Kit
| # | Component / Hook | Props Sketch | Replaces / Consolidates (Files) | Effort | Exists Today? |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `PageShell` | `{ title, subtitle, badge, actions, children }` | Page headers in `items.tsx`, `transactions.tsx`, `purchases-shell.tsx` | S | Partial (`PurchasesShell`) |
| 2 | `SectionCard` | `{ title, subtitle, actions, children, className }` | Raw `<section className="rounded-xl border border-slate-200 bg-white p-5...">` | XS | Yes (`ui/panel.tsx`) |
| 3 | `DataTable` | `{ data, columns, pagination, stickyHeader, footer }` | Ad-hoc `<table>` in `transactions.tsx`, `casting/log.tsx`, `purchase-bills-table.tsx`| M | No (`ui/table.tsx` is unused) |
| 4 | `FilterBar` | `{ search, onSearch, filters, actions }` | Search/filter strips in `transactions.tsx`, `purchase-logs.tsx`, `ledger.tsx` | S | No |
| 5 | `KpiCard` | `{ label, value, subtext, delta, tone, icon }` | `MonthStat` in `index.tsx`, `Metric` in `casting/materials.tsx`, `snapshot-tiles.tsx` | XS | Partial (`ui/stat-tile.tsx`) |
| 6 | `MoneyCell` | `{ valuePaise, valueRupees, tone, className }` | Scattered `formatInrInteger` / `formatPaiseInr` spans | XS | No |
| 7 | `StatusChip` | `{ label, tone, variant }` | Inline spans in `purchase-bills-table.tsx`, `StatusPill` in `business-dashboard.tsx` | XS | Partial (`StatusPill`) |
| 8 | `SegmentedToggle` | `{ value, onChange, options }` | Raw button toggles in `items.tsx`, `transactions.tsx`, `ledger.tsx` | XS | No |
| 9 | `ConfirmModal` | `{ open, title, description, onConfirm, onCancel, tone }`| `window.confirm` & custom modal overlays | XS | Yes (`ui/confirm-dialog.tsx`) |
| 10 | `FormField` | `{ label, error, required, children }` | Fragmented `<label>` + `<span>` across all forms | XS | Yes (`ui/form-field.tsx`) |
| 11 | `EmptyState` | `{ title, description, icon, action }` | Inline "No records found" paragraphs across 8 files | XS | Yes (`ui/empty-state.tsx`) |
| 12 | `MonthPicker` | `{ value, onChange }` | Raw `<input type="month">` in `calendar.tsx`, `export-reports.tsx` | S | No |
| 13 | `ExportDropdown`| `{ onExportPdf, onExportXlsx, onExportCsv, onExportJpg }`| Duplicate export buttons in `ledger.tsx`, `export-reports.tsx`, `purchase-logs.tsx` | S | No |
| 14 | `ModuleGate` | `{ module: 'purchase' \| 'casting', fallback, children }` | Ad-hoc `castingEnabled` checks in `index.tsx`, `sidebar-nav.tsx` | S | Partial (`useModuleSettings`) |

## 9. Migration Plan
1. **Foundation**: Promote shared primitives in `src/components/ui/` (`SectionCard`, `KpiCard`, `StatusChip`, `MoneyCell`, `EmptyState`, `ConfirmModal`, `FormField`).
2. **Phase A (Items)**: Refactor `/items` into 3 tabs (`Selling`, `Purchase`, `Casting`) using `SegmentedToggle`, `DataTable`, `FormField`.
3. **Phase B (Casting)**: Refactor `/casting/*` to use `PageShell`, `DataTable`, and centered `ConfirmModal`. Retire custom trash overlay.
4. **Phase C (Purchase)**: Unify `/purchase-bills`, `/purchase-logs`, and `/suppliers`. Replace `BillDetailDrawer` with centered modals; unify buttons and focus rings.
5. **Phase D (Dashboard & Settings)**: Redesign Main Dashboard (`/`) with `MonthPicker`, `KpiCard`, and `ModuleGate` (backed by shared PocketBase `app_settings`).
6. **Phase E (Party Ledger)**: Unify Customer & Supplier ledgers into 2 tabs on `/ledger` using `PageShell` and `DataTable`.
7. **Phase F (Sales — Touch Last)**: Align `/transactions`, `/new-bill`, and `/new-payment` to shared `DataTable` and `inputClass` after kit is proven.
*Verification*: Run headless Playwright screenshot comparisons before and after each phase using `scripts/smoke-ui.mjs`.

## 10. Top 10 Quick Wins (< 30 lines each)
1. **Remove Duplicate H1s**: Delete local `<h1>` in `items.tsx:157`, `export-reports.tsx:551`, and `supplier-ledger.$supplierId.tsx:459`.
2. **Standardize `inputClass`**: Export single input styling constant with slate focus ring from `src/components/ui/input.tsx` and import in forms.
3. **Replace `BillDetailDrawer`**: Convert drawer in `purchase-bills` to centered Radix `Dialog` to match Sales/Casting.
4. **Fix Purchase Button Styles**: Change primary buttons in `purchase-logs.tsx` and `purchases-shell.tsx` to `bg-slate-900 text-white`.
5. **Adopt `<EmptyState />`**: Replace ad-hoc text in `transactions.tsx:430`, `purchase-logs.tsx:530`, and `casting/log.tsx:500`.
6. **Add `tabular-nums`**: Add `font-mono tabular-nums` to money cells in `purchase-bills-table.tsx` and `casting/log.tsx`.
7. **Unify Status Tones**: Map Kacha/GST and Paid/Partial badges to `StatusPill` with standard palette (`emerald`, `amber`, `rose`, `slate`).
8. **Add `aria-label` to Action Buttons**: Add accessible labels to edit/delete/view icons in `transactions.tsx` and `purchase-logs.tsx`.
9. **Add `min-w-[700px]` to Tables**: Add horizontal overflow container and minimum table width to prevent column squashing on laptop viewports.
10. **Add 25-Row Pagination to Logs**: Implement `slice((page - 1) * 25, page * 25)` with next/prev buttons in `transactions.tsx`.

## 11. Tooling & Dependencies
- **Typecheck**: `npm run typecheck` (`@tanstack/router-cli generate && tsc -b --pretty false`).
- **Tests**: `npm test` (`vitest run`). Run single test: `npx vitest run path/to/file.test.ts`.
- **Build**: `npm run build` (`router:generate && tsc -b && vite build`). Full verify: `npm run verify`.
- **Component Playground**: No Storybook exists. A lightweight dev route (`/dev/components` in `src/routes/`) can be added in < 1 hour with 0 production bundle impact.
- **Icons**: `lucide-react ^1.11.0` (ESM tree-shaken, only imported icons are bundled).
- **Charts**: `recharts ^3.10.1` (~371 kB vendor bundle `BarChart-0LrmU5Gc.js`, 106 kB gzip; already isolated in Vite chunk).
