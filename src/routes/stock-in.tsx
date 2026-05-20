import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Edit3, History, PackagePlus, Search, SlidersHorizontal, Trash2, Warehouse } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { isGasStockItem, loadItems, type ItemRecord } from '@/data/items'
import {
  deleteStockAdjustment,
  deleteStockIn,
  ensureGeneralCustomer,
  loadCurrentStock,
  loadMonthlyStockReport,
  loadStockAdjustments,
  loadStockCustomers,
  loadStockIn,
  loadStockLedger,
  loadStockOpenings,
  saveStockOpening,
  saveStockAdjustment,
  saveStockIn,
  updateStockIn,
  type CurrentStockRecord,
  type StockCustomerOption,
} from '@/data/stock'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatInQty, parseNonNegativeNumber } from '@/lib/inr-format'
import { matchesAnyRankedQuery } from '@/lib/search'

export const Route = createFileRoute('/stock-in')({
  component: StockInPage,
})

const stockInSchema = z.object({
  itemId: z.string().trim().min(1, 'Please select an item'),
  customerId: z.string().trim().min(1, 'Please select a party'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid stock date'),
  qty: z.number().positive('Qty is required'),
  note: z.string(),
})

const adjustmentSchema = stockInSchema.extend({
  qty: z.number().refine((value) => value !== 0, 'Adjustment qty is required'),
})

type StockPanel = 'opening' | 'receive' | 'adjust'
type AuditPanel = 'ledger' | 'logs' | 'report'

export function StockPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [itemId, setItemId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [qtyInput, setQtyInput] = useState('0')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [openingDate, setOpeningDate] = useState(today)
  const [openingItemId, setOpeningItemId] = useState('')
  const [openingCustomerId, setOpeningCustomerId] = useState('')
  const [openingQtyInput, setOpeningQtyInput] = useState('0')
  const [openingNote, setOpeningNote] = useState('')
  const [adjustmentDate, setAdjustmentDate] = useState(today)
  const [adjustmentItemId, setAdjustmentItemId] = useState('')
  const [adjustmentCustomerId, setAdjustmentCustomerId] = useState('')
  const [adjustmentQtyInput, setAdjustmentQtyInput] = useState('0')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [search, setSearch] = useState('')
  const [stockSearch, setStockSearch] = useState('')
  const [ledgerItemId, setLedgerItemId] = useState('')
  const [ledgerCustomerId, setLedgerCustomerId] = useState('')
  const [reportMonth, setReportMonth] = useState(() => getLocalIsoDate().slice(0, 7))
  const [activePanel, setActivePanel] = useState<StockPanel>('receive')
  const [auditPanel, setAuditPanel] = useState<AuditPanel>('ledger')
  const [statusText, setStatusText] = useState('')

  const itemsQuery = useQuery({ queryKey: ['items-options'], queryFn: loadItems })
  const customersQuery = useQuery({ queryKey: ['stock-customers'], queryFn: loadStockCustomers })
  const openingsQuery = useQuery({ queryKey: ['stock-openings'], queryFn: loadStockOpenings })
  const currentStockQuery = useQuery({ queryKey: ['current-stock'], queryFn: loadCurrentStock })
  const stockInQuery = useQuery({ queryKey: ['stock-in-log'], queryFn: loadStockIn })
  const adjustmentsQuery = useQuery({ queryKey: ['stock-adjustments-log'], queryFn: loadStockAdjustments })
  const ledgerQuery = useQuery({
    queryKey: ['stock-ledger', ledgerItemId, ledgerCustomerId],
    queryFn: () => loadStockLedger(ledgerItemId, ledgerCustomerId),
    enabled: Boolean(ledgerItemId && ledgerCustomerId),
  })
  const stockReportQuery = useQuery({
    queryKey: ['monthly-stock-report', reportMonth],
    queryFn: () => loadMonthlyStockReport(reportMonth),
  })

  const gasItems = useMemo(() => (itemsQuery.data ?? []).filter(isGasStockItem), [itemsQuery.data])
  const gasItemKeys = useMemo(() => new Set(gasItems.flatMap((item) => [item.id, item.name.trim().toLowerCase()])), [gasItems])
  const customers = customersQuery.data ?? []
  const selectedItem = gasItems.find((item) => item.id === itemId)
  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const selectedOpeningItem = gasItems.find((item) => item.id === openingItemId)
  const selectedOpeningCustomer = customers.find((customer) => customer.id === openingCustomerId)
  const selectedAdjustmentItem = gasItems.find((item) => item.id === adjustmentItemId)
  const selectedAdjustmentCustomer = customers.find((customer) => customer.id === adjustmentCustomerId)
  const selectedUnit = unitLabel(selectedItem)
  const openingUnit = unitLabel(selectedOpeningItem)
  const adjustmentUnit = unitLabel(selectedAdjustmentItem)
  const gasStockInRows = (stockInQuery.data ?? []).filter((row) => gasItemKeys.has(row.itemId) || gasItemKeys.has(row.itemName.trim().toLowerCase()))
  const gasAdjustmentRows = (adjustmentsQuery.data ?? []).filter((row) => gasItemKeys.has(row.itemId) || gasItemKeys.has(row.itemName.trim().toLowerCase()))
  const filteredStockInRows = gasStockInRows.filter((row) => matchesAnyRankedQuery([row.itemName, row.customerName, row.date, formatFullDate(row.date)], search))
  const stockItems = currentStockQuery.data ?? []
  const attentionItems = stockItems.filter((item) => item.currentStock <= 0)
  const positiveItems = stockItems.filter((item) => item.currentStock > 0)
  const totalClosingStock = stockItems.reduce((sum, item) => sum + item.currentStock, 0)
  const normalizedStockSearch = stockSearch.trim()
  const stockGlanceRows = useMemo(
    () =>
      stockItems
        .filter((row) => matchesAnyRankedQuery([row.itemName, row.customerName], normalizedStockSearch))
        .sort((a, b) => {
        const aAttention = a.currentStock <= 0 ? 0 : 1
        const bAttention = b.currentStock <= 0 ? 0 : 1
        if (aAttention !== bAttention) return aAttention - bAttention
        const itemCompare = a.itemName.localeCompare(b.itemName)
        if (itemCompare !== 0) return itemCompare
        return a.customerName.localeCompare(b.customerName)
      }),
    [stockItems, normalizedStockSearch],
  )
  const selectedLedgerItem = gasItems.find((row) => row.id === ledgerItemId)
  const selectedLedgerCustomer = customers.find((row) => row.id === ledgerCustomerId)

  useEffect(() => {
    if (customersQuery.isLoading || customers.length > 0) return
    void ensureGeneralCustomer().then(async (general) => {
      setCustomerDefaults(general.id)
      await queryClient.invalidateQueries({ queryKey: ['stock-customers'] })
    })
  }, [customers.length, customersQuery.isLoading, queryClient])

  useEffect(() => {
    const general = findGeneralCustomer(customers)
    if (!general) return
    setCustomerDefaults(general.id)
  }, [customers])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = stockInSchema.safeParse({ itemId, customerId, date, qty: parseNonNegativeNumber(qtyInput), note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid stock entry')
      const item = selectedItem
      const customer = selectedCustomer
      if (!item) throw new Error('Please select an item')
      if (!customer) throw new Error('Please select a party')
      const payload = { itemId: item.id, itemName: item.name, customerId: customer.id, customerName: customer.name, date: parsed.data.date, qty: parsed.data.qty, note: parsed.data.note }
      if (editingId) {
        await updateStockIn(editingId, payload)
      } else {
        await saveStockIn(payload)
      }
    },
    onSuccess: async () => {
      setStatusText(editingId ? 'Stock in updated.' : 'Stock in saved.')
      resetStockInForm()
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const openingMutation = useMutation({
    mutationFn: async () => {
      const parsed = stockInSchema.safeParse({ itemId: openingItemId, customerId: openingCustomerId, date: openingDate, qty: parseNonNegativeNumber(openingQtyInput), note: openingNote })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid opening stock')
      const item = selectedOpeningItem
      const customer = selectedOpeningCustomer
      if (!item) throw new Error('Please select an item')
      if (!customer) throw new Error('Please select a party')
      await saveStockOpening({ itemId: item.id, itemName: item.name, customerId: customer.id, customerName: customer.name, date: parsed.data.date, qty: parsed.data.qty, note: parsed.data.note })
    },
    onSuccess: async () => {
      setStatusText('Opening stock saved.')
      resetOpeningForm()
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteStockIn,
    onSuccess: async () => {
      setStatusText('Stock in entry deleted.')
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(adjustmentQtyInput)
      const parsed = adjustmentSchema.safeParse({ itemId: adjustmentItemId, customerId: adjustmentCustomerId, date: adjustmentDate, qty: Number.isFinite(qty) ? qty : 0, note: adjustmentNote })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid adjustment')
      const item = selectedAdjustmentItem
      const customer = selectedAdjustmentCustomer
      if (!item) throw new Error('Please select an item')
      if (!customer) throw new Error('Please select a party')
      await saveStockAdjustment({ itemId: item.id, itemName: item.name, customerId: customer.id, customerName: customer.name, date: parsed.data.date, qty: parsed.data.qty, note: parsed.data.note })
    },
    onSuccess: async () => {
      setStatusText('Stock adjustment saved.')
      resetAdjustmentForm()
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const deleteAdjustmentMutation = useMutation({
    mutationFn: deleteStockAdjustment,
    onSuccess: async () => {
      setStatusText('Stock adjustment deleted.')
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  function resetStockInForm() {
    setEditingId(null)
    setDate(today)
    setItemId('')
    setCustomerId(findGeneralCustomer(customers)?.id ?? '')
    setQtyInput('0')
    setNote('')
  }

  function resetOpeningForm() {
    setOpeningDate(today)
    setOpeningItemId('')
    setOpeningCustomerId(findGeneralCustomer(customers)?.id ?? '')
    setOpeningQtyInput('0')
    setOpeningNote('')
  }

  function resetAdjustmentForm() {
    setAdjustmentDate(today)
    setAdjustmentItemId('')
    setAdjustmentCustomerId(findGeneralCustomer(customers)?.id ?? '')
    setAdjustmentQtyInput('0')
    setAdjustmentNote('')
  }

  function setCustomerDefaults(nextCustomerId: string) {
    setCustomerId((current) => current || nextCustomerId)
    setOpeningCustomerId((current) => current || nextCustomerId)
    setAdjustmentCustomerId((current) => current || nextCustomerId)
    setLedgerCustomerId((current) => current || nextCustomerId)
  }

  function startEditStockIn(row: NonNullable<typeof stockInQuery.data>[number]) {
    setEditingId(row.id)
    setDate(row.date)
    setItemId(row.itemId)
    setCustomerId(row.customerId)
    setQtyInput(String(row.qty))
    setNote(row.note)
    setStatusText('')
    setActivePanel('receive')
  }

  function selectBucketForReceive(row: CurrentStockRecord) {
    setEditingId(null)
    setDate(today)
    setItemId(row.itemId)
    setCustomerId(row.customerId)
    setQtyInput('0')
    setNote('')
    setStatusText('')
    setActivePanel('receive')
  }

  function selectBucketForAdjust(row: CurrentStockRecord) {
    setAdjustmentDate(today)
    setAdjustmentItemId(row.itemId)
    setAdjustmentCustomerId(row.customerId)
    setAdjustmentQtyInput('0')
    setAdjustmentNote('')
    setStatusText('')
    setActivePanel('adjust')
  }

  function selectBucketForLedger(row: CurrentStockRecord) {
    setLedgerItemId(row.itemId)
    setLedgerCustomerId(row.customerId)
    setAuditPanel('ledger')
  }

  return (
    <div className="w-full space-y-4 px-3 pb-24 pt-3 sm:px-4 lg:px-6">
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StockSummaryPill label="Total Buckets" value={String(stockItems.length)} />
        <StockSummaryPill label="In Stock" value={String(positiveItems.length)} tone="green" />
        <StockSummaryPill label="Needs Attention" value={String(attentionItems.length)} tone={attentionItems.length > 0 ? 'red' : 'slate'} />
        <StockSummaryPill label="Closing Stock" value={formatStockQty(totalClosingStock, gasItems[0])} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Inventory</h3>
            <p className="mt-0.5 text-xs text-slate-500">Search item + party buckets, check closing stock, and act quickly.</p>
          </div>
          <label className="relative w-full sm:w-80">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={`${inputClass} pl-9`}
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
              placeholder="Search item or party..."
            />
          </label>
        </div>
        {currentStockQuery.isLoading && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading stock...</p>}
        {currentStockQuery.isError && <ErrorText error={currentStockQuery.error} fallback="Unable to load stock." />}
        {!currentStockQuery.isLoading && !currentStockQuery.isError && (
          <CurrentStockGlance
            rows={stockGlanceRows}
            onReceive={selectBucketForReceive}
            onAdjust={selectBucketForAdjust}
            onOpenLedger={selectBucketForLedger}
          />
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {statusText && (
          <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status" aria-live="polite">
            {statusText}
          </p>
        )}
        <div className="mb-4 overflow-x-auto no-scrollbar">
          <div className="inline-flex min-w-max rounded-lg border border-slate-200 bg-slate-50 p-1">
            <PanelButton active={activePanel === 'opening'} onClick={() => setActivePanel('opening')} icon={<Warehouse size={14} />}>Opening</PanelButton>
            <PanelButton active={activePanel === 'receive'} onClick={() => setActivePanel('receive')} icon={<PackagePlus size={14} />}>Receive</PanelButton>
            <PanelButton active={activePanel === 'adjust'} onClick={() => setActivePanel('adjust')} icon={<SlidersHorizontal size={14} />}>Adjust</PanelButton>
          </div>
        </div>

        {activePanel === 'opening' && (
          <WorkspacePanel title="Opening Stock" subtitle="Set opening stock for each item and party bucket. Saving again updates the same item + party opening.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[150px_1fr_1fr_160px_1fr_auto]">
              <Field label="Date">
                <DateInput className={inputClass} value={openingDate} onChange={setOpeningDate} />
              </Field>
              <Field label="Item">
                <SearchableCombobox
                  options={gasItems}
                  value={openingItemId}
                  onChange={setOpeningItemId}
                  inputClassName={inputClass}
                  placeholder={itemsQuery.isLoading ? 'Loading items...' : 'Search item...'}
                  disabled={itemsQuery.isLoading || itemsQuery.isError}
                  emptyText="No matching gas part found."
                  maxResults={25}
                />
              </Field>
              <Field label="Party">
                <SearchableCombobox
                  options={customers}
                  value={openingCustomerId}
                  onChange={setOpeningCustomerId}
                  inputClassName={inputClass}
                  placeholder={customersQuery.isLoading ? 'Loading parties...' : 'Search party...'}
                  disabled={customersQuery.isLoading || customersQuery.isError}
                  emptyText="No matching party found."
                  maxResults={25}
                />
              </Field>
              <Field label={`Opening (${openingUnit})`}>
                <input className={inputClass} type="number" value={openingQtyInput} onChange={(event) => setOpeningQtyInput(event.target.value)} />
              </Field>
              <Field label="Note">
                <input className={inputClass} value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="Opening balance note" />
              </Field>
              <div className="sticky bottom-0 z-20 -mx-5 flex items-end gap-2 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur md:static md:mx-0 md:border-t-0 md:bg-transparent md:p-0">
                <button type="button" className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 lg:h-10 lg:px-3" onClick={resetOpeningForm}>
                  Clear
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 md:flex-none lg:h-10 lg:px-3"
                  onClick={() => void openingMutation.mutateAsync()}
                  disabled={!openingItemId || !openingCustomerId || openingMutation.isPending}
                >
                  <Warehouse size={14} />
                  {openingMutation.isPending ? 'Saving...' : 'Save Opening'}
                </button>
              </div>
            </div>
            <div className="mt-5">
              <OpeningTable rows={openingsQuery.data ?? []} items={gasItems} />
            </div>
          </WorkspacePanel>
        )}

        {activePanel === 'receive' && (
          <WorkspacePanel title={editingId ? 'Edit Stock Receipt' : 'Receive Finished Goods'} subtitle="Add stock produced or received into finished goods inventory.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[150px_1fr_1fr_160px_1fr_auto]">
              <Field label="Date">
                <DateInput className={inputClass} value={date} onChange={setDate} />
              </Field>
              <Field label="Item">
                <SearchableCombobox
                  options={gasItems}
                  value={itemId}
                  onChange={(nextId) => {
                    setItemId(nextId)
                    setStatusText('')
                  }}
                  inputClassName={inputClass}
                  placeholder={itemsQuery.isLoading ? 'Loading items...' : 'Search item...'}
                  disabled={itemsQuery.isLoading || itemsQuery.isError}
                  emptyText="No matching gas part found."
                  maxResults={25}
                />
              </Field>
              <Field label="Party">
                <SearchableCombobox
                  options={customers}
                  value={customerId}
                  onChange={(nextId) => {
                    setCustomerId(nextId)
                    setStatusText('')
                  }}
                  inputClassName={inputClass}
                  placeholder={customersQuery.isLoading ? 'Loading parties...' : 'Search party...'}
                  disabled={customersQuery.isLoading || customersQuery.isError}
                  emptyText="No matching party found."
                  maxResults={25}
                />
              </Field>
              <Field label={`Qty (${selectedUnit})`}>
                <input className={inputClass} type="number" value={qtyInput} onChange={(event) => setQtyInput(event.target.value)} />
              </Field>
              <Field label="Note">
                <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Production batch, source, remark" />
              </Field>
              <div className="sticky bottom-0 z-20 -mx-5 flex items-end gap-2 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur md:static md:mx-0 md:border-t-0 md:bg-transparent md:p-0">
                <button type="button" className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 lg:h-10 lg:px-3" onClick={resetStockInForm}>
                  Clear
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 md:flex-none lg:h-10 lg:px-3"
                  onClick={() => void saveMutation.mutateAsync()}
                  disabled={!itemId || !customerId || parseNonNegativeNumber(qtyInput) <= 0 || saveMutation.isPending}
                >
                  <PackagePlus size={14} />
                  {saveMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </WorkspacePanel>
        )}

        {activePanel === 'adjust' && (
          <WorkspacePanel title="Manual Stock Adjustment" subtitle="Use for physical count corrections, damage, shortage, or audit corrections. Positive adds stock, negative removes stock.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[150px_1fr_1fr_160px_1fr_auto]">
              <Field label="Date">
                <DateInput className={inputClass} value={adjustmentDate} onChange={setAdjustmentDate} />
              </Field>
              <Field label="Item">
                <SearchableCombobox
                  options={gasItems}
                  value={adjustmentItemId}
                  onChange={setAdjustmentItemId}
                  inputClassName={inputClass}
                  placeholder={itemsQuery.isLoading ? 'Loading items...' : 'Search item...'}
                  disabled={itemsQuery.isLoading || itemsQuery.isError}
                  emptyText="No matching gas part found."
                  maxResults={25}
                />
              </Field>
              <Field label="Party">
                <SearchableCombobox
                  options={customers}
                  value={adjustmentCustomerId}
                  onChange={setAdjustmentCustomerId}
                  inputClassName={inputClass}
                  placeholder={customersQuery.isLoading ? 'Loading parties...' : 'Search party...'}
                  disabled={customersQuery.isLoading || customersQuery.isError}
                  emptyText="No matching party found."
                  maxResults={25}
                />
              </Field>
              <Field label={`Adjustment (${adjustmentUnit})`}>
                <input className={inputClass} type="number" value={adjustmentQtyInput} onChange={(event) => setAdjustmentQtyInput(event.target.value)} />
              </Field>
              <Field label="Reason / Note">
                <input className={inputClass} value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Damage, correction, physical count" />
              </Field>
              <div className="sticky bottom-0 z-20 -mx-5 flex items-end gap-2 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur md:static md:mx-0 md:border-t-0 md:bg-transparent md:p-0">
                <button type="button" className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 lg:h-10 lg:px-3" onClick={resetAdjustmentForm}>
                  Clear
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 md:flex-none lg:h-10 lg:px-3"
                  onClick={() => void adjustmentMutation.mutateAsync()}
                  disabled={!adjustmentItemId || !adjustmentCustomerId || Number(adjustmentQtyInput) === 0 || adjustmentMutation.isPending}
                >
                  <SlidersHorizontal size={14} />
                  {adjustmentMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </WorkspacePanel>
        )}

      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Audit & Reports</h3>
            <p className="mt-1 text-xs text-slate-500">Open ledger, review logs, and check monthly movement when needed.</p>
          </div>
          <div className="inline-flex min-w-max rounded-lg border border-slate-200 bg-slate-50 p-1">
            <PanelButton active={auditPanel === 'ledger'} onClick={() => setAuditPanel('ledger')} icon={<History size={14} />}>Ledger</PanelButton>
            <PanelButton active={auditPanel === 'logs'} onClick={() => setAuditPanel('logs')} icon={<Warehouse size={14} />}>Logs</PanelButton>
            <PanelButton active={auditPanel === 'report'} onClick={() => setAuditPanel('report')} icon={<ClipboardList size={14} />}>Report</PanelButton>
          </div>
        </div>

        {auditPanel === 'report' && (
          <WorkspacePanel title="Monthly Stock Report" subtitle={`${formatMonthYear(reportMonth)} opening, stock in, sold, adjustment, closing.`}>
            <div className="mb-3 flex justify-end">
              <input className={`${inputClass} w-44`} type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            </div>
            {stockReportQuery.isLoading && <p className="text-sm text-slate-500">Loading stock report...</p>}
            {stockReportQuery.isError && <ErrorText error={stockReportQuery.error} fallback="Unable to load stock report." />}
            {!stockReportQuery.isLoading && !stockReportQuery.isError && <StockReportTable rows={stockReportQuery.data ?? []} />}
          </WorkspacePanel>
        )}

        {auditPanel === 'ledger' && (
          <WorkspacePanel title="Item + Party Stock Ledger" subtitle={selectedLedgerItem && selectedLedgerCustomer ? `Full movement for ${selectedLedgerItem.name} / ${selectedLedgerCustomer.name}` : 'Select an item and party to inspect opening, receipts, sold, adjustments, and running balance.'}>
            <div className="mb-3 grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
              <SearchableCombobox
                options={gasItems}
                value={ledgerItemId}
                onChange={setLedgerItemId}
                inputClassName={inputClass}
                placeholder={itemsQuery.isLoading ? 'Loading items...' : 'Search item ledger...'}
                disabled={itemsQuery.isLoading || itemsQuery.isError}
                emptyText="No matching gas part found."
                maxResults={25}
              />
              <SearchableCombobox
                options={customers}
                value={ledgerCustomerId}
                onChange={setLedgerCustomerId}
                inputClassName={inputClass}
                placeholder={customersQuery.isLoading ? 'Loading parties...' : 'Search party ledger...'}
                disabled={customersQuery.isLoading || customersQuery.isError}
                emptyText="No matching party found."
                maxResults={25}
              />
            </div>
            {(!ledgerItemId || !ledgerCustomerId) && <p className="text-sm text-slate-500">Select an item and party to view full movement.</p>}
            {ledgerQuery.isLoading && <p className="text-sm text-slate-500">Loading ledger...</p>}
            {ledgerQuery.isError && <ErrorText error={ledgerQuery.error} fallback="Unable to load stock ledger." />}
            {ledgerItemId && ledgerCustomerId && !ledgerQuery.isLoading && !ledgerQuery.isError && (
              <LedgerTable rows={ledgerQuery.data ?? []} item={selectedLedgerItem} />
            )}
          </WorkspacePanel>
        )}

        {auditPanel === 'logs' && (
          <WorkspacePanel title="Stock Logs" subtitle="Review and correct stock receipts and manual adjustments.">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-900">Stock In Log</h4>
              <input className={`${inputClass} max-w-xs`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item or DD-MM-YYYY" />
            </div>
            {stockInQuery.isLoading && <p className="text-sm text-slate-500">Loading stock in log...</p>}
            {stockInQuery.isError && <ErrorText error={stockInQuery.error} fallback="Unable to load stock in log." />}
            {!stockInQuery.isLoading && !stockInQuery.isError && (
                <StockInTable rows={filteredStockInRows} items={gasItems} onEdit={startEditStockIn} onDelete={(id) => void deleteMutation.mutateAsync(id)} deleting={deleteMutation.isPending} />
            )}
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h4 className="mb-3 text-sm font-semibold text-slate-900">Adjustment Log</h4>
              {adjustmentsQuery.isLoading && <p className="text-sm text-slate-500">Loading adjustments...</p>}
              {adjustmentsQuery.isError && <ErrorText error={adjustmentsQuery.error} fallback="Unable to load adjustments." />}
              {!adjustmentsQuery.isLoading && !adjustmentsQuery.isError && (
                <AdjustmentTable rows={gasAdjustmentRows} items={gasItems} onDelete={(id) => void deleteAdjustmentMutation.mutateAsync(id)} deleting={deleteAdjustmentMutation.isPending} />
              )}
            </div>
          </WorkspacePanel>
        )}
      </section>

    </div>
  )
}

function StockInPage() {
  return <StockPage />
}

async function invalidateStockQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['stock-openings'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-in-log'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-adjustments-log'] }),
    queryClient.invalidateQueries({ queryKey: ['current-stock'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] }),
    queryClient.invalidateQueries({ queryKey: ['monthly-stock-report'] }),
  ])
}

function PanelButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
        active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
      }`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

function WorkspacePanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function StockSummaryPill({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'green' | 'red' }) {
  const toneClass = tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  )
}

function CurrentStockGlance({
  rows,
  onReceive,
  onAdjust,
  onOpenLedger,
}: {
  rows: CurrentStockRecord[]
  onReceive: (item: CurrentStockRecord) => void
  onAdjust: (item: CurrentStockRecord) => void
  onOpenLedger: (item: CurrentStockRecord) => void
}) {
  if (rows.length === 0) {
    return <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">No finished goods stock buckets configured.</p>
  }

  return (
    <div className="h-[30vh] min-h-[260px] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map((item) => {
          const isNegative = item.currentStock < 0
          const needsAttention = item.currentStock <= 0
          const closing = formatStockQtyParts(item.currentStock, item)
          const monthIn = formatStockQtyParts(item.stockInThisMonth, item)
          const monthSold = formatStockQtyParts(item.soldThisMonth, item)
          const monthAdjustment = formatStockQtyParts(item.adjustmentThisMonth, item)
          const statusLabel = isNegative ? 'Negative' : needsAttention ? 'Attention' : 'In Stock'
          const statusClass = isNegative ? 'bg-red-100 text-red-700' : needsAttention ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
          return (
            <article key={item.id} className={`rounded-lg border p-3 shadow-sm ${isNegative ? 'border-red-200 bg-red-50/60' : needsAttention ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-slate-950">{item.itemName}</h4>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{item.customerName}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${statusClass}`}>
                  {statusLabel}
                </span>
              </div>

              <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Closing Balance</div>
                <div className={`mt-1 flex items-baseline gap-1.5 font-mono ${item.currentStock < 0 ? 'text-red-700' : 'text-slate-950'}`}>
                  <span className="text-2xl font-bold leading-none">{closing.main}</span>
                  <span className="text-xs font-medium text-slate-500">{closing.secondary}</span>
                </div>
              </div>

              <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">This Month</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
                  <span>In {monthIn.main}</span>
                  <span>Sold {monthSold.main}</span>
                  <span>Adj {monthAdjustment.main}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" className="rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-800" onClick={() => onReceive(item)}>
                  Receive
                </button>
                <button type="button" className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => onAdjust(item)}>
                  Adjust
                </button>
                <button type="button" className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => onOpenLedger(item)}>
                  Ledger
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function StockReportTable({ rows }: { rows: Array<Awaited<ReturnType<typeof loadMonthlyStockReport>>[number]> }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[860px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Item</Th>
            <Th>Party</Th>
            <Th right>Opening</Th>
            <Th right>Stock In</Th>
            <Th right>Sold</Th>
            <Th right>Adjustment</Th>
            <Th right>Closing</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={7} text="No stock items configured." />}
          {rows.map((row, index) => {
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td strong>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono>{formatStockQty(row.opening, row)}</Td>
                <Td right mono>{formatStockQty(row.stockIn, row)}</Td>
                <Td right mono>{formatStockQty(row.sold, row)}</Td>
                <Td right mono>{formatStockQty(row.adjustment, row)}</Td>
                <Td right mono>{formatStockQty(row.closing, row)}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OpeningTable({ rows, items }: { rows: Array<Awaited<ReturnType<typeof loadStockOpenings>>[number]>; items: ItemRecord[] }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Date</Th><Th>Item</Th><Th>Party</Th><Th right>Opening</Th><Th>Note</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5} text="No opening stock records found." />}
          {rows.map((row, index) => {
            const item = items.find((entry) => entry.id === row.itemId || entry.name === row.itemName)
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
                <Td strong>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono>{formatStockQty(row.qty, item)}</Td>
                <Td>{row.note || '-'}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StockInTable({ rows, items, onEdit, onDelete, deleting }: { rows: Array<Awaited<ReturnType<typeof loadStockIn>>[number]>; items: ItemRecord[]; onEdit: (row: Awaited<ReturnType<typeof loadStockIn>>[number]) => void; onDelete: (id: string) => void; deleting: boolean }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Date</Th><Th>Item</Th><Th>Party</Th><Th right>Qty</Th><Th>Note</Th><Th right>Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} text="No stock in entries found." />}
          {rows.map((row, index) => {
            const item = items.find((entry) => entry.id === row.itemId || entry.name === row.itemName)
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td>{formatFullDate(row.date)}</Td>
                <Td strong>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono>{formatStockQty(row.qty, item)}</Td>
                <Td>{row.note || '-'}</Td>
                <Td right>
                  <div className="inline-flex gap-2">
                    <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => onEdit(row)}>
                      <Edit3 size={12} /> Edit
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => onDelete(row.id)} disabled={deleting}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AdjustmentTable({ rows, items, onDelete, deleting }: { rows: Array<Awaited<ReturnType<typeof loadStockAdjustments>>[number]>; items: ItemRecord[]; onDelete: (id: string) => void; deleting: boolean }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[760px]">
        <thead><tr className="bg-slate-50"><Th>Date</Th><Th>Item</Th><Th>Party</Th><Th right>Adjustment</Th><Th>Note</Th><Th right>Action</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} text="No stock adjustments yet." />}
          {rows.map((row, index) => {
            const item = items.find((entry) => entry.id === row.itemId || entry.name === row.itemName)
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td>{formatFullDate(row.date)}</Td>
                <Td strong>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono>{formatStockQty(row.qty, item)}</Td>
                <Td>{row.note || '-'}</Td>
                <Td right>
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => onDelete(row.id)} disabled={deleting}>
                    <Trash2 size={12} /> Delete
                  </button>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function findGeneralCustomer(customers: StockCustomerOption[]) {
  return customers.find((customer) => customer.customerName.toLowerCase() === 'general' || customer.companyName.toLowerCase() === 'general')
}

function LedgerTable({ rows, item }: { rows: Array<Awaited<ReturnType<typeof loadStockLedger>>[number]>; item?: ItemRecord }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[860px]">
        <thead><tr className="bg-slate-50"><Th>Date</Th><Th>Type</Th><Th right>In</Th><Th right>Out</Th><Th right>Balance</Th><Th>Note</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} text="No ledger movement found." />}
          {rows.map((row, index) => (
            <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
              <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
              <Td strong>{row.type}</Td>
              <Td right mono>{row.inQty ? formatStockQty(row.inQty, item) : '-'}</Td>
              <Td right mono>{row.outQty ? formatStockQty(row.outQty, item) : '-'}</Td>
              <Td right mono>{formatStockQty(row.balance, item)}</Td>
              <Td>{row.note || '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ErrorText({ error, fallback }: { error: unknown; fallback: string }) {
  return <p className="text-sm text-red-600">{fallback} {error instanceof Error ? error.message : ''}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, right = false, mono = false, strong = false }: { children: ReactNode; right?: boolean; mono?: boolean; strong?: boolean }) {
  return <td className={`px-3 py-3 text-sm text-slate-700 ${right ? 'text-right' : ''} ${mono ? 'font-mono' : ''} ${strong ? 'font-medium text-slate-800' : ''}`}>{children}</td>
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-slate-500">{text}</td>
    </tr>
  )
}

function unitLabel(item?: { unit: string } | null) {
  if (!item?.unit) return 'pieces'
  return item.unit === 'piece' ? 'pieces' : item.unit
}

function formatStockQty(qty: number, item?: { type?: string; unit?: string; bagWeight?: number } | null) {
  if (item?.type === 'gas') {
    const bagWeight = item.bagWeight || 50
    const bags = qty / bagWeight
    const bagText = `${bags.toFixed(Number.isInteger(bags) ? 0 : 1)} bags`
    return `${formatInQty(qty, 'kg')} / ${bagText}`
  }
  return formatInQty(qty, unitLabel(item ? { unit: item.unit ?? '' } : null))
}

function formatStockQtyParts(qty: number, item?: { type?: string; unit?: string; bagWeight?: number } | null) {
  if (item?.type === 'gas') {
    const bagWeight = item.bagWeight || 50
    const bags = qty / bagWeight
    const bagsText = `${bags.toFixed(Number.isInteger(bags) ? 0 : 1)} bags`
    return { main: bagsText, secondary: `(${formatInQty(qty, 'kg')})` }
  }
  return { main: formatInQty(qty, unitLabel(item ? { unit: item.unit ?? '' } : null)), secondary: '' }
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
