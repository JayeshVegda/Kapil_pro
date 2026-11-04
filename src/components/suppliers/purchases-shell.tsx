import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { SupplierFormModal, emptySupplierFormState, type SupplierFormState } from '@/components/suppliers/supplier-form-modal'
import { createSupplier, loadSuppliersSummary, type SupplierSummary } from '@/data/suppliers'
import { formatPaiseInr } from '@/lib/inr-format'

type RailChip = 'all' | 'due' | 'advance' | 'inactive'

const CHIP_LABEL: Record<RailChip, string> = {
  all: 'All',
  due: 'With Due',
  advance: 'Advance',
  inactive: 'Inactive',
}

const COLLAPSE_KEY = 'kapil-supplier-rail-collapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Persistent supplier rail shown beside every Purchases page. Selecting a
 * supplier filters the current page via the ?supplier= URL param (or navigates
 * to that supplier's ledger when already on a supplier page).
 */
export function PurchasesShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The rail is shared by many purchase routes with different search schemas, so the
  // param is merged unchecked instead of through the per-route typed reducer.
  const navigateAny = useNavigate() as unknown as (options: Record<string, unknown>) => void
  const locationSearch = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>
  const selectedSupplierId = typeof locationSearch.supplier === 'string' ? locationSearch.supplier : ''

  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [chip, setChip] = useState<RailChip>('all')
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [collapsed])

  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: loadSuppliersSummary })
  const allSuppliers = suppliersQuery.data ?? []

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allSuppliers
      .filter((s) => {
        if (chip === 'inactive') return !s.supplier.active
        if (!s.supplier.active) return false
        if (chip === 'due') return s.outstandingPaise > 0
        if (chip === 'advance') return s.advancePaise > 0
        return true
      })
      .filter((s) => {
        if (!needle) return true
        const hay = `${s.supplier.companyName} ${s.supplier.city} ${s.supplier.phone} ${s.supplier.contactName}`.toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise || a.supplier.companyName.localeCompare(b.supplier.companyName))
  }, [allSuppliers, chip, query])

  const selectSupplier = (supplierId: string | null) => {
    if (pathname.startsWith('/supplier-ledger/')) {
      if (supplierId) {
        void navigate({ to: '/supplier-ledger/$supplierId', params: { supplierId } })
      }
      return
    }
    const next: Record<string, unknown> = { ...locationSearch, supplier: supplierId ?? undefined }
    if (!supplierId) delete next.supplier
    void navigateAny({ replace: true, search: next })
  }

  return (
    <div className="flex w-full items-stretch">
      <aside
        className={`sticky top-0 flex h-[calc(100dvh-0px)] shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] ${
          collapsed ? 'w-11' : 'w-64'
        }`}
      >
        <div className="flex items-center justify-between px-2 pt-2.5">
          {!collapsed && <span className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Suppliers</span>}
          <button
            type="button"
            aria-label={collapsed ? 'Expand supplier rail' : 'Collapse supplier rail'}
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {!collapsed && (
          <>
            <div className="px-2.5 pb-2 pt-1.5">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  placeholder="Search suppliers..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(Object.keys(CHIP_LABEL) as RailChip[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setChip(key)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                      chip === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {CHIP_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <button
                type="button"
                onClick={() => selectSupplier(null)}
                className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedSupplierId === '' ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>All Suppliers</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-400">{rows.length}</span>
              </button>

              {suppliersQuery.isLoading && <p className="px-2 py-3 text-xs text-slate-400">Loading…</p>}
              {rows.map((s) => (
                <SupplierRailRow
                  key={s.supplier.id}
                  summary={s}
                  selected={selectedSupplierId === s.supplier.id}
                  onSelect={() => selectSupplier(s.supplier.id)}
                />
              ))}
              {!suppliersQuery.isLoading && rows.length === 0 && <p className="px-2 py-3 text-xs italic text-slate-400">No suppliers match.</p>}
            </div>

            <div className="border-t border-slate-100 p-2">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                <Plus size={13} /> Add Supplier
              </button>
            </div>
          </>
        )}
      </aside>

      <main className="min-w-0 flex-1">{children}</main>

      {addOpen && (
        <RailAddSupplierModal
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setAddOpen(false)
            selectSupplier(id)
          }}
        />
      )}
    </div>
  )
}

function SupplierRailRow({ summary, selected, onSelect }: { summary: SupplierSummary; selected: boolean; onSelect: () => void }) {
  const s = summary.supplier
  return (
    <button
      type="button"
      onClick={onSelect}
      title={s.companyName}
      className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-md border-l-2 px-2 py-1.5 text-left transition ${
        selected ? 'border-l-blue-500 bg-blue-50' : 'border-l-transparent hover:bg-slate-50'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {summary.bardanPendingCount > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="Bardan pending" />}
        <span className={`truncate text-xs ${selected ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{s.companyName}</span>
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {summary.advancePaise > 0 ? (
          <span className="text-emerald-600">{formatPaiseInr(summary.advancePaise)}</span>
        ) : summary.outstandingPaise > 0 ? (
          <span className="text-rose-600">{formatPaiseInr(summary.outstandingPaise)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </span>
    </button>
  )
}

function RailAddSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [formState, setFormState] = useState<SupplierFormState>(emptySupplierFormState)
  const [errorText, setErrorText] = useState('')

  const createMutation = useMutation({
    mutationFn: async (state: SupplierFormState) => {
      const openingKachaPaise = (state.openingKachaDirection === 'we_owe' ? 1 : -1) * Math.round(state.openingKachaRupees * 100)
      const openingGstPaise = (state.openingGstDirection === 'we_owe' ? 1 : -1) * Math.round(state.openingGstRupees * 100)
      return createSupplier({
        companyName: state.companyName.trim(),
        contactName: state.contactName,
        phone: state.phone,
        gstNo: state.gstNo,
        city: state.city,
        notes: state.notes,
        openingKachaPaise,
        openingGstPaise,
        openingBalanceDate: state.openingBalanceDate,
        active: state.active,
      })
    },
    onSuccess: async (created) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, created.id)
      onCreated(created.id)
    },
    onError: (error) => setErrorText(toUserMessage(error)),
  })

  return (
    <SupplierFormModal
      formState={formState}
      isSaving={createMutation.isPending}
      errorText={errorText}
      onChange={setFormState}
      onClose={onClose}
      onSave={() => createMutation.mutate(formState)}
    />
  )
}
