import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ClipboardList, Edit3, History, PackagePlus, SlidersHorizontal, Trash2, Warehouse } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { isGasStockItem, loadItems, type ItemRecord } from '@/data/items'
import {
  deleteStockAdjustment,
  deleteStockIn,
  loadCurrentStock,
  loadMonthlyStockReport,
  loadStockAdjustments,
  loadStockIn,
  loadStockLedger,
  saveStockAdjustment,
  saveStockIn,
  updateStockIn,
  type CurrentStockRecord,
} from '@/data/stock'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { PENDING_COMMAND_STORAGE_KEY, parseContextCommand } from '@/lib/commands'
import { formatInQty, parseNonNegativeNumber } from '@/lib/inr-format'
import { matchesAnyRankedQuery } from '@/lib/search'

export const Route = createFileRoute('/stock-in')({
  component: StockInPage,
})

const stockInSchema = z.object({
  itemId: z.string().trim().min(1, 'Please select an item'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid stock date'),
  qty: z.number().positive('Qty is required'),
  note: z.string(),
})

const adjustmentSchema = stockInSchema.extend({
  qty: z.number().refine((value) => value !== 0, 'Adjustment qty is required'),
})

type StockPanel = 'receive' | 'adjust' | 'report' | 'ledger' | 'logs'

export function StockPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [itemId, setItemId] = useState('')
  const [qtyInput, setQtyInput] = useState('0')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adjustmentDate, setAdjustmentDate] = useState(today)
  const [adjustmentItemId, setAdjustmentItemId] = useState('')
  const [adjustmentQtyInput, setAdjustmentQtyInput] = useState('0')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [search, setSearch] = useState('')
  const [ledgerItemId, setLedgerItemId] = useState('')
  const [reportMonth, setReportMonth] = useState(() => getLocalIsoDate().slice(0, 7))
  const [activePanel, setActivePanel] = useState<StockPanel>('receive')
  const [statusText, setStatusText] = useState('')
  const [quickStockCommand, setQuickStockCommand] = useState('')
  const [isQuickStockOpen, setIsQuickStockOpen] = useState(false)
  const [isStockConfirmOpen, setIsStockConfirmOpen] = useState(false)

  const itemsQuery = useQuery({ queryKey: ['items-options'], queryFn: loadItems })
  const currentStockQuery = useQuery({ queryKey: ['current-stock'], queryFn: loadCurrentStock })
  const stockInQuery = useQuery({ queryKey: ['stock-in-log'], queryFn: loadStockIn })
  const adjustmentsQuery = useQuery({ queryKey: ['stock-adjustments-log'], queryFn: loadStockAdjustments })
  const ledgerQuery = useQuery({
    queryKey: ['stock-ledger', ledgerItemId],
    queryFn: () => loadStockLedger(ledgerItemId),
    enabled: Boolean(ledgerItemId),
  })
  const stockReportQuery = useQuery({
    queryKey: ['monthly-stock-report', reportMonth],
    queryFn: () => loadMonthlyStockReport(reportMonth),
  })

  const gasItems = useMemo(() => (itemsQuery.data ?? []).filter(isGasStockItem), [itemsQuery.data])
  const gasItemKeys = useMemo(() => new Set(gasItems.flatMap((item) => [item.id, item.name.trim().toLowerCase()])), [gasItems])
  const selectedItem = gasItems.find((item) => item.id === itemId)
  const selectedAdjustmentItem = gasItems.find((item) => item.id === adjustmentItemId)
  const selectedUnit = unitLabel(selectedItem)
  const adjustmentUnit = unitLabel(selectedAdjustmentItem)
  const gasStockInRows = (stockInQuery.data ?? []).filter((row) => gasItemKeys.has(row.itemId) || gasItemKeys.has(row.itemName.trim().toLowerCase()))
  const gasAdjustmentRows = (adjustmentsQuery.data ?? []).filter((row) => gasItemKeys.has(row.itemId) || gasItemKeys.has(row.itemName.trim().toLowerCase()))
  const filteredStockInRows = gasStockInRows.filter((row) => matchesAnyRankedQuery([row.itemName, row.date, formatFullDate(row.date)], search))
  const stockItems = currentStockQuery.data ?? []
  const attentionItems = stockItems.filter((item) => item.currentStock <= 0)
  const positiveItems = stockItems.filter((item) => item.currentStock > 0)
  const totalStockEntries = gasStockInRows.length + gasAdjustmentRows.length
  const selectedLedgerItem = gasItems.find((row) => row.id === ledgerItemId)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = stockInSchema.safeParse({ itemId, date, qty: parseNonNegativeNumber(qtyInput), note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid stock entry')
      const item = selectedItem
      if (!item) throw new Error('Please select an item')
      const payload = { itemId: item.id, itemName: item.name, date: parsed.data.date, qty: parsed.data.qty, note: parsed.data.note }
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
      const parsed = adjustmentSchema.safeParse({ itemId: adjustmentItemId, date: adjustmentDate, qty: Number.isFinite(qty) ? qty : 0, note: adjustmentNote })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid adjustment')
      const item = selectedAdjustmentItem
      if (!item) throw new Error('Please select an item')
      await saveStockAdjustment({ itemId: item.id, itemName: item.name, date: parsed.data.date, qty: parsed.data.qty, note: parsed.data.note })
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
    setQtyInput('0')
    setNote('')
    setIsStockConfirmOpen(false)
  }

  function resetAdjustmentForm() {
    setAdjustmentDate(today)
    setAdjustmentItemId('')
    setAdjustmentQtyInput('0')
    setAdjustmentNote('')
  }

  function startEditStockIn(row: NonNullable<typeof stockInQuery.data>[number]) {
    setEditingId(row.id)
    setDate(row.date)
    setItemId(row.itemId)
    setQtyInput(String(row.qty))
    setNote(row.note)
    setStatusText('')
    setActivePanel('receive')
  }

  function applyStockCommand(input: string) {
    const parsed = parseContextCommand(input, 'stock', {
      items: gasItems,
      today,
    })
    if (!parsed.ok) {
      setStatusText(parsed.error)
      return
    }
    if (parsed.command.kind !== 'stock') {
      setStatusText('This command is not a stock command.')
      return
    }
    setEditingId(null)
    setDate(parsed.command.date)
    setItemId(parsed.command.item.id)
    setQtyInput(String(parsed.command.qty))
    setNote(parsed.command.note)
    setActivePanel('receive')
    setStatusText(`Command ready: ${parsed.command.item.name} | ${parsed.command.displayQty}`)
    setIsQuickStockOpen(false)
    setQuickStockCommand('')
    setIsStockConfirmOpen(true)
  }

  function applyQuickStockCommand() {
    applyStockCommand(quickStockCommand)
  }

  async function confirmStockCommand() {
    try {
      await saveMutation.mutateAsync()
      setIsStockConfirmOpen(false)
    } catch {
      // mutation shows status text
    }
  }

  useEffect(() => {
    if (itemsQuery.isLoading) return
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_STORAGE_KEY)
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { kind?: string; body?: string; createdAt?: number }
      if (pending.kind !== 'stock' || !pending.body || Date.now() - Number(pending.createdAt ?? 0) > 60_000) return
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
      applyStockCommand(pending.body)
    } catch {
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
    }
  }, [itemsQuery.isLoading, gasItems])

  useEffect(() => {
    if (!isStockConfirmOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void confirmStockCommand()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isStockConfirmOpen, itemId, qtyInput, date, note, saveMutation.isPending])

  return (
    <div className="w-full space-y-4 px-3 pb-24 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Finished goods</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Stock Control</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Receive finished goods, correct physical stock, review monthly movement, and audit every item from one place.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[34rem]">
            <StockStat label="Tracked Items" value={String(stockItems.length)} icon={<Warehouse size={14} />} />
            <StockStat label="In Stock" value={String(positiveItems.length)} icon={<PackagePlus size={14} />} />
            <StockStat label="Needs Attention" value={String(attentionItems.length)} tone={attentionItems.length > 0 ? 'red' : 'green'} icon={<AlertTriangle size={14} />} />
            <StockStat label="Entries" value={String(totalStockEntries)} icon={<History size={14} />} />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setIsQuickStockOpen(true)}>
            Stock Command
          </button>
        </div>
        {statusText && (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status" aria-live="polite">
            {statusText}
          </p>
        )}
      </section>

      {isQuickStockOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Stock Command</h3>
              <button type="button" className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsQuickStockOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-2 px-4 py-4">
              <input
                autoFocus
                className={inputClass}
                value={quickStockCommand}
                onChange={(event) => setQuickStockCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyQuickStockCommand()
                  }
                }}
                placeholder='item qty [date=today|-1|DD-MM-YYYY] ["note"]'
              />
              <p className="text-xs text-slate-500">Gas qty rule: 20 means 20 bags. Use kg suffix for exact kg.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsQuickStockOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={applyQuickStockCommand}>
                Review Stock In
              </button>
            </div>
          </div>
        </div>
      )}

      {isStockConfirmOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Confirm Stock In</h3>
              <p className="mt-1 text-xs text-slate-500">Ctrl+Enter confirms save</p>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm text-slate-700">
              <ConfirmRow label="Item" value={selectedItem?.name ?? 'Unknown'} />
              <ConfirmRow label="Qty" value={formatStockQty(parseNonNegativeNumber(qtyInput), selectedItem)} />
              <ConfirmRow label="Date" value={formatFullDate(date)} />
              {note && <ConfirmRow label="Note" value={note} />}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsStockConfirmOpen(false)}>
                Back to Edit
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void confirmStockCommand()}
                disabled={!itemId || parseNonNegativeNumber(qtyInput) <= 0 || saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 overflow-x-auto no-scrollbar">
          <div className="inline-flex min-w-max rounded-lg border border-slate-200 bg-slate-50 p-1">
            <PanelButton active={activePanel === 'receive'} onClick={() => setActivePanel('receive')} icon={<PackagePlus size={14} />}>Receive</PanelButton>
            <PanelButton active={activePanel === 'adjust'} onClick={() => setActivePanel('adjust')} icon={<SlidersHorizontal size={14} />}>Adjust</PanelButton>
            <PanelButton active={activePanel === 'report'} onClick={() => setActivePanel('report')} icon={<ClipboardList size={14} />}>Report</PanelButton>
            <PanelButton active={activePanel === 'ledger'} onClick={() => setActivePanel('ledger')} icon={<History size={14} />}>Ledger</PanelButton>
            <PanelButton active={activePanel === 'logs'} onClick={() => setActivePanel('logs')} icon={<Warehouse size={14} />}>Logs</PanelButton>
          </div>
        </div>

        {activePanel === 'receive' && (
          <WorkspacePanel title={editingId ? 'Edit Stock Receipt' : 'Receive Finished Goods'} subtitle="Add stock produced or received into finished goods inventory.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[160px_1fr_180px_1fr_auto]">
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
                  disabled={!itemId || parseNonNegativeNumber(qtyInput) <= 0 || saveMutation.isPending}
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[160px_1fr_180px_1fr_auto]">
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
                  disabled={!adjustmentItemId || Number(adjustmentQtyInput) === 0 || adjustmentMutation.isPending}
                >
                  <SlidersHorizontal size={14} />
                  {adjustmentMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </WorkspacePanel>
        )}

        {activePanel === 'report' && (
          <WorkspacePanel title="Monthly Stock Report" subtitle={`${formatMonthYear(reportMonth)} opening, stock in, sold, adjustment, closing.`}>
            <div className="mb-3 flex justify-end">
              <input className={`${inputClass} w-44`} type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            </div>
            {stockReportQuery.isLoading && <p className="text-sm text-slate-500">Loading stock report...</p>}
            {stockReportQuery.isError && <ErrorText error={stockReportQuery.error} fallback="Unable to load stock report." />}
            {!stockReportQuery.isLoading && !stockReportQuery.isError && <StockReportTable rows={stockReportQuery.data ?? []} />}
          </WorkspacePanel>
        )}

        {activePanel === 'ledger' && (
          <WorkspacePanel title="Item Stock Ledger" subtitle={selectedLedgerItem ? `Full movement for ${selectedLedgerItem.name}` : 'Select an item to inspect opening, receipts, sold, adjustments, and running balance.'}>
            <div className="mb-3 max-w-md">
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
            </div>
            {!ledgerItemId && <p className="text-sm text-slate-500">Select an item to view full movement.</p>}
            {ledgerQuery.isLoading && <p className="text-sm text-slate-500">Loading ledger...</p>}
            {ledgerQuery.isError && <ErrorText error={ledgerQuery.error} fallback="Unable to load stock ledger." />}
            {ledgerItemId && !ledgerQuery.isLoading && !ledgerQuery.isError && (
              <LedgerTable rows={ledgerQuery.data ?? []} item={selectedLedgerItem} />
            )}
          </WorkspacePanel>
        )}

        {activePanel === 'logs' && (
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Current Stock</h3>
          {attentionItems.length > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">{attentionItems.length} item needs attention</span>}
        </div>
        {currentStockQuery.isLoading && <p className="text-sm text-slate-500">Loading stock...</p>}
        {currentStockQuery.isError && <ErrorText error={currentStockQuery.error} fallback="Unable to load stock." />}
        {!currentStockQuery.isLoading && !currentStockQuery.isError && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {stockItems.length === 0 && <p className="text-sm text-slate-500">No finished goods stock items configured.</p>}
            {stockItems.map((item) => (
              <StockCard
                key={item.id}
                item={item}
                onOpenLedger={() => {
                  setLedgerItemId(item.id)
                  setActivePanel('ledger')
                }}
              />
            ))}
          </div>
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
    queryClient.invalidateQueries({ queryKey: ['stock-in-log'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-adjustments-log'] }),
    queryClient.invalidateQueries({ queryKey: ['current-stock'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] }),
    queryClient.invalidateQueries({ queryKey: ['monthly-stock-report'] }),
  ])
}

function StockStat({ label, value, icon, tone = 'slate' }: { label: string; value: string; icon: ReactNode; tone?: 'slate' | 'green' | 'red' }) {
  const toneClass = tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <div className={`min-h-[4.75rem] rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 font-mono text-2xl font-bold leading-tight">{value}</p>
    </div>
  )
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

function StockCard({ item, onOpenLedger }: { item: CurrentStockRecord; onOpenLedger: () => void }) {
  const indicatorClass = item.currentStock > 0 ? 'bg-emerald-500' : item.currentStock === 0 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <button type="button" className="min-h-[8rem] rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40" onClick={onOpenLedger}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.06em] text-slate-500" title={item.name}>{item.name}</p>
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${indicatorClass}`} aria-hidden="true" />
      </div>
      <p className="mt-2 font-mono text-2xl font-bold leading-tight tracking-tight text-slate-900">{formatStockQty(item.currentStock, item)}</p>
      <p className="mt-1 text-[11px] text-slate-500">Opening {formatStockQty(item.openingStock, item)} {item.openingStockDate ? `on ${formatFullDate(item.openingStockDate)}` : ''}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] leading-snug text-slate-500">
        <MiniStock label="In" value={formatStockQty(item.stockInThisMonth, item)} />
        <MiniStock label="Sold" value={formatStockQty(item.soldThisMonth, item)} />
        <MiniStock label="Adj" value={formatStockQty(item.adjustmentThisMonth, item)} />
      </div>
    </button>
  )
}

function StockReportTable({ rows }: { rows: Array<Awaited<ReturnType<typeof loadMonthlyStockReport>>[number]> }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[860px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Item</Th>
            <Th right>Opening</Th>
            <Th right>Stock In</Th>
            <Th right>Sold</Th>
            <Th right>Adjustment</Th>
            <Th right>Closing</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} text="No stock items configured." />}
          {rows.map((row, index) => {
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td strong>{row.name}</Td>
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

function MiniStock({ label, value }: { label: string; value: string }) {
  return (
    <p>
      {label}
      <span className="block truncate font-mono font-semibold text-slate-800">{value}</span>
    </p>
  )
}

function StockInTable({ rows, items, onEdit, onDelete, deleting }: { rows: Array<Awaited<ReturnType<typeof loadStockIn>>[number]>; items: ItemRecord[]; onEdit: (row: Awaited<ReturnType<typeof loadStockIn>>[number]) => void; onDelete: (id: string) => void; deleting: boolean }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Date</Th><Th>Item</Th><Th right>Qty</Th><Th>Note</Th><Th right>Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5} text="No stock in entries found." />}
          {rows.map((row, index) => {
            const item = items.find((entry) => entry.id === row.itemId || entry.name === row.itemName)
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td>{formatFullDate(row.date)}</Td>
                <Td strong>{row.itemName}</Td>
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
        <thead><tr className="bg-slate-50"><Th>Date</Th><Th>Item</Th><Th right>Adjustment</Th><Th>Note</Th><Th right>Action</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5} text="No stock adjustments yet." />}
          {rows.map((row, index) => {
            const item = items.find((entry) => entry.id === row.itemId || entry.name === row.itemName)
            return (
              <tr key={row.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                <Td>{formatFullDate(row.date)}</Td>
                <Td strong>{row.itemName}</Td>
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

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
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

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
