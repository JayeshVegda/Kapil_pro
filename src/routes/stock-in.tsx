import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList,
  Download,
  FileText,
  PackagePlus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { buildStockInventorySummary, StockInventoryStrip } from '@/components/stock/stock-inventory-strip'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { isGasStockItem, loadItems } from '@/data/items'
import {
  deleteStockAdjustment,
  deleteStockIn,
  deleteStockOpening,
  ensureGeneralCustomer,
  loadCurrentStock,
  loadMonthlyStockReport,
  loadRecentStockLogs,
  loadStockCustomers,
  loadStockIn,
  loadStockLedger,
  loadStockOpenings,
  saveStockAdjustment,
  saveStockIn,
  saveStockOpening,
  updateStockAdjustment,
  updateStockIn,
  type CurrentStockRecord,
  type MonthlyStockReportRow,
  type RecentStockLogRecord,
  type StockCustomerOption,
  type StockInRecord,
  type StockLedgerRow,
  type StockOpeningRecord,
} from '@/data/stock'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInQty } from '@/lib/inr-format'
import { matchesAnyRankedQuery } from '@/lib/search'
import { PENDING_COMMAND_STORAGE_KEY, parseContextCommand } from '@/lib/commands'

export const Route = createFileRoute('/stock-in')({
  component: StockInPage,
})

const stockEntrySchema = z.object({
  itemId: z.string().trim().min(1, 'Please select an item'),
  customerId: z.string().trim().min(1, 'Please select a party'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid stock date'),
  qty: z.number().positive('Qty is required'),
  note: z.string(),
})

const adjustmentSchema = stockEntrySchema.extend({
  mode: z.enum(['add', 'subtract', 'set']),
  reason: z.string(),
})

type ReceiveMode = 'receive' | 'opening'
type AdjustmentMode = 'add' | 'subtract' | 'set'
type WorkspaceTab = 'receive' | 'opening' | 'adjust' | 'report'
type EditableStockLogType = 'received' | 'adjusted'
type StockLogType = EditableStockLogType | 'sold'
type EditingLog = { type: EditableStockLogType; id: string } | null
type StockLogRow = {
  id: string
  rawId: string
  itemId: string
  customerId: string
  type: StockLogType
  date: string
  itemName: string
  customerName: string
  inQty: number
  outQty: number
  balance: number
  note: string
}

export function StockPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const currentMonth = today.slice(0, 7)
  const previousMonth = previousMonthKey(currentMonth)
  const financialYearMonths = useMemo(() => fiscalYearMonthKeys(today), [today])

  const [statusText, setStatusText] = useState('')
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('receive')
  const [detailItem, setDetailItem] = useState<CurrentStockRecord | null>(null)
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('receive')
  const [date, setDate] = useState(today)
  const [itemId, setItemId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [qtyInput, setQtyInput] = useState('0')
  const [note, setNote] = useState('')
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>('add')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [editingLog, setEditingLog] = useState<EditingLog>(null)
  const [reportMonth, setReportMonth] = useState(currentMonth)
  const [logSearch, setLogSearch] = useState('')
  const [logType, setLogType] = useState<'all' | StockLogType>('all')

  const itemsQuery = useQuery({ queryKey: ['items-options'], queryFn: loadItems })
  const customersQuery = useQuery({ queryKey: ['stock-customers'], queryFn: loadStockCustomers })
  const currentStockQuery = useQuery({ queryKey: ['current-stock'], queryFn: loadCurrentStock })
  const currentMonthReportQuery = useQuery({
    queryKey: ['monthly-stock-report', currentMonth],
    queryFn: () => loadMonthlyStockReport(currentMonth),
  })
  const previousMonthReportQuery = useQuery({
    queryKey: ['monthly-stock-report', previousMonth],
    queryFn: () => loadMonthlyStockReport(previousMonth),
  })
  const financialYearReportQueries = useQueries({
    queries: financialYearMonths.map((month) => ({
      queryKey: ['monthly-stock-report', month],
      queryFn: () => loadMonthlyStockReport(month),
    })),
  })
  const stockReportQuery = useQuery({
    queryKey: ['monthly-stock-report', reportMonth],
    queryFn: () => loadMonthlyStockReport(reportMonth),
    enabled: activeTab === 'report',
  })
  const stockInQuery = useQuery({
    queryKey: ['stock-in-log'],
    queryFn: loadStockIn,
  })
  const recentLogsQuery = useQuery({
    queryKey: ['recent-stock-logs'],
    queryFn: () => loadRecentStockLogs(),
  })
  const openingsQuery = useQuery({
    queryKey: ['stock-openings'],
    queryFn: loadStockOpenings,
  })
  const detailLedgerQuery = useQuery({
    queryKey: ['stock-ledger', detailItem?.itemId ?? '', detailItem?.customerId ?? ''],
    queryFn: () => loadStockLedger(detailItem?.itemId ?? '', detailItem?.customerId ?? ''),
    enabled: Boolean(detailItem),
  })

  const gasItems = useMemo(() => (itemsQuery.data ?? []).filter(isGasStockItem), [itemsQuery.data])
  const gasItemKeys = useMemo(() => new Set(gasItems.flatMap((item) => [item.id, item.name.trim().toLowerCase()])), [gasItems])
  const customers = customersQuery.data ?? []
  const stockItems = currentStockQuery.data ?? []
  const fiscalRows = financialYearReportQueries.flatMap((query) => query.data ?? [])
  const fiscalReportRows = buildFiscalReportRows(financialYearReportQueries.map((query) => query.data ?? []))
  const selectedItem = gasItems.find((item) => item.id === itemId)
  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const selectedBucket = stockItems.find((item) => item.itemId === itemId && item.customerId === customerId)
  const sortedStockItems = useMemo(() => [...stockItems].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName)), [stockItems])
  const summary = useMemo(() => {
    return buildStockInventorySummary({
      stockItems,
      currentRows: currentMonthReportQuery.data ?? [],
      previousRows: previousMonthReportQuery.data ?? [],
      fiscalRows,
    })
  }, [currentMonthReportQuery.data, financialYearReportQueries, previousMonthReportQuery.data, stockItems])
  const logs = useMemo(() => {
    return (recentLogsQuery.data ?? [])
      .filter((row) => gasItemKeys.has(row.itemId) || gasItemKeys.has(row.itemName.trim().toLowerCase()))
      .map(mapRecentStockLog)
      .filter((row) => logType === 'all' || row.type === logType)
      .filter((row) => matchesAnyRankedQuery([row.itemName, row.customerName, row.date, row.type, row.note], logSearch))
  }, [gasItemKeys, logSearch, logType, recentLogsQuery.data])

  useEffect(() => {
    if (customersQuery.isLoading || customers.length > 0) return
    void ensureGeneralCustomer().then(async (general) => {
      setCustomerId(general.id)
      await queryClient.invalidateQueries({ queryKey: ['stock-customers'] })
    })
  }, [customers.length, customersQuery.isLoading, queryClient])

  useEffect(() => {
    const general = findGeneralCustomer(customers)
    if (general) setCustomerId((current) => current || general.id)
  }, [customers])

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error('Please select an item')
      if (!selectedCustomer) throw new Error('Please select a party')
      const qty = parseStockQtyInput(qtyInput, selectedItem)
      const parsed = stockEntrySchema.safeParse({ itemId, customerId, date, qty, note })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid stock entry')
      const payload = {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        date: parsed.data.date,
        qty: parsed.data.qty,
        note: parsed.data.note,
      }
      if (editingLog?.type === 'received') await updateStockIn(editingLog.id, payload)
      else if (receiveMode === 'opening') await saveStockOpening(payload)
      else await saveStockIn(payload)
    },
    onSuccess: async () => {
      setStatusText('')
      resetEntryForm()
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error('Please select an item')
      if (!selectedCustomer) throw new Error('Please select a party')
      const inputQty = parseStockQtyInput(qtyInput, selectedItem)
      const parsed = adjustmentSchema.safeParse({
        itemId,
        customerId,
        date,
        qty: inputQty,
        note,
        mode: adjustmentMode,
        reason: adjustmentReason,
      })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid adjustment')
      const qty = adjustmentQty(parsed.data.qty, adjustmentMode, selectedBucket?.currentStock ?? 0)
      if (qty === 0) throw new Error('Adjustment qty is zero.')
      const payload = {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        date: parsed.data.date,
        qty,
        note: [adjustmentReason.trim(), note.trim()].filter(Boolean).join(' - '),
      }
      if (editingLog?.type === 'adjusted') await updateStockAdjustment(editingLog.id, payload)
      else await saveStockAdjustment(payload)
    },
    onSuccess: async () => {
      setStatusText('')
      resetEntryForm()
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const deleteReceivedMutation = useMutation({
    mutationFn: deleteStockIn,
    onSuccess: async () => {
      setStatusText('')
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const deleteAdjustmentMutation = useMutation({
    mutationFn: deleteStockAdjustment,
    onSuccess: async () => {
      setStatusText('')
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const deleteOpeningMutation = useMutation({
    mutationFn: deleteStockOpening,
    onSuccess: async () => {
      setStatusText('')
      await invalidateStockQueries(queryClient)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  function resetEntryForm() {
    setDate(today)
    setItemId('')
    setCustomerId(findGeneralCustomer(customers)?.id ?? '')
    setQtyInput('0')
    setNote('')
    setReceiveMode('receive')
    setAdjustmentMode('add')
    setAdjustmentReason('')
    setEditingLog(null)
  }

  function openReceive(row?: CurrentStockRecord) {
    setReceiveMode('receive')
    setDate(today)
    setItemId(row?.itemId ?? '')
    setCustomerId(row?.customerId || findGeneralCustomer(customers)?.id || '')
    setQtyInput('0')
    setNote('')
    setStatusText('')
    setEditingLog(null)
    setActiveTab('receive')
  }

  function openAdjust(row?: CurrentStockRecord) {
    setAdjustmentMode('add')
    setDate(today)
    setItemId(row?.itemId ?? '')
    setCustomerId(row?.customerId || findGeneralCustomer(customers)?.id || '')
    setQtyInput('0')
    setAdjustmentReason('')
    setNote('')
    setStatusText('')
    setEditingLog(null)
    setActiveTab('adjust')
  }

  function openDetail(row: CurrentStockRecord) {
    setDetailItem(row)
    setStatusText('')
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
    const general = findGeneralCustomer(customers)
    setReceiveMode('receive')
    setEditingLog(null)
    setDate(parsed.command.date)
    setItemId(parsed.command.item.id)
    setCustomerId(general?.id ?? customerId)
    setQtyInput(String(kgToBags(parsed.command.qty, parsed.command.item)))
    setNote(parsed.command.note)
    setActiveTab('receive')
    setStatusText(`Command ready: ${parsed.command.item.name} | ${parsed.command.displayQty}`)
  }

  useEffect(() => {
    if (itemsQuery.isLoading || customersQuery.isLoading) return
    if (gasItems.length === 0 || customers.length === 0) return
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_STORAGE_KEY)
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { kind?: string; body?: string; createdAt?: number }
      if (pending.kind !== 'stock') return
      if (!pending.body || Date.now() - Number(pending.createdAt ?? 0) > 60_000) {
        window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
        return
      }
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
      applyStockCommand(pending.body)
    } catch {
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
    }
  }, [customers.length, customersQuery.isLoading, gasItems, itemsQuery.isLoading])

  function exportMonthlyCsv() {
    const rows = stockReportQuery.data ?? []
    const csvRows = [
      ['Item', 'Party', 'Opening', 'Stock In', 'Sold', 'Adjustment', 'Closing'],
      ...rows.map((row) => [row.itemName, row.customerName, row.opening, row.stockIn, row.sold, row.adjustment, row.closing]),
    ]
    downloadCsv(`stock-report-${reportMonth}.csv`, csvRows)
  }

  function exportLogsCsv() {
    downloadCsv('stock-logs.csv', [
      ['Date', 'Type', 'Item', 'Party', 'Received', 'Sold', 'Balance', 'Note'],
      ...logs.map((row) => [row.date, row.type, row.itemName, row.customerName, row.inQty, row.outQty, row.balance, row.note]),
    ])
  }

  function editLog(row: StockLogRow) {
    if (row.type === 'sold') return
    setEditingLog({ type: row.type, id: row.rawId })
    setDate(row.date)
    setItemId(row.itemId)
    setCustomerId(row.customerId)
    const qty = row.type === 'adjusted' && row.outQty > 0 ? row.outQty : row.inQty
    setQtyInput(String(Math.abs(kgToBags(qty, stockItems.find((item) => item.itemId === row.itemId)))))
    setNote(row.note)
    setAdjustmentReason(row.type === 'adjusted' ? row.note : '')
    setAdjustmentMode(row.type === 'adjusted' && row.outQty > 0 ? 'subtract' : 'add')
    setActiveTab(row.type === 'received' ? 'receive' : 'adjust')
    setStatusText('')
  }

  function editOpening(row: StockOpeningRecord) {
    const item = gasItems.find((entry) => entry.id === row.itemId || entry.name === row.itemName) ?? stockItems.find((entry) => entry.itemId === row.itemId || entry.itemName === row.itemName)
    setReceiveMode('opening')
    setActiveTab('opening')
    setDate(row.date || today)
    setItemId(row.itemId)
    setCustomerId(row.customerId)
    setQtyInput(String(kgToBags(row.qty, item)))
    setNote(row.note)
    setEditingLog(null)
    setStatusText('')
  }

  function deleteLog(row: StockLogRow) {
    if (row.type === 'sold') return
    if (row.type === 'received') void deleteReceivedMutation.mutateAsync(row.rawId)
    else void deleteAdjustmentMutation.mutateAsync(row.rawId)
  }

  return (
    <div className="w-full space-y-3 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {statusText && (
        <section>
          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm" role="status" aria-live="polite">
            {statusText}
          </p>
        </section>
      )}

      <section>
        {currentStockQuery.isLoading && <p className="rounded-lg bg-white px-3 py-10 text-center text-sm text-slate-500 shadow-sm">Loading stock...</p>}
        {currentStockQuery.isError && <ErrorText error={currentStockQuery.error} fallback="Unable to load stock." />}
        {!currentStockQuery.isLoading && !currentStockQuery.isError && (
          <StockInventoryStrip rows={sortedStockItems} summary={summary} item={stockItems[0]} onSelect={openDetail} />
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-100/80 px-3 py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ActionButton active={activeTab === 'receive'} icon={<PackagePlus size={16} />} onClick={() => openReceive()}>Receive Stock</ActionButton>
            <ActionButton active={activeTab === 'opening'} icon={<PackagePlus size={16} />} onClick={() => {
              openReceive()
              setReceiveMode('opening')
              setActiveTab('opening')
            }}>Opening Balance</ActionButton>
            <ActionButton active={activeTab === 'adjust'} icon={<SlidersHorizontal size={16} />} onClick={() => openAdjust()}>Adjust Stock</ActionButton>
            <ActionButton active={activeTab === 'report'} icon={<ClipboardList size={16} />} onClick={() => setActiveTab('report')}>Report</ActionButton>
          </div>
        </div>

        <div className="bg-white p-4">
          {activeTab === 'receive' && (
            <>
              {editingLog?.type === 'received' && <WorkspaceHeader title="Edit Stock Receipt" subtitle="Update the saved stock receipt." />}
              <ReceiveForm
                date={date}
                setDate={setDate}
                itemId={itemId}
                setItemId={setItemId}
                customerId={customerId}
                setCustomerId={setCustomerId}
                qtyInput={qtyInput}
                setQtyInput={setQtyInput}
                note={note}
                setNote={setNote}
                items={gasItems}
                customers={customers}
                selectedItem={selectedItem}
                recentRows={(stockInQuery.data ?? []).slice(0, 5)}
                itemsLoading={itemsQuery.isLoading}
                customersLoading={customersQuery.isLoading}
                pending={receiveMutation.isPending}
                onCancel={resetEntryForm}
                onSave={() => void receiveMutation.mutateAsync()}
                showRecent
              />
            </>
          )}
          {activeTab === 'opening' && (
            <>
              <ReceiveForm
                date={date}
                setDate={setDate}
                itemId={itemId}
                setItemId={setItemId}
                customerId={customerId}
                setCustomerId={setCustomerId}
                qtyInput={qtyInput}
                setQtyInput={setQtyInput}
                note={note}
                setNote={setNote}
                items={gasItems}
                customers={customers}
                selectedItem={selectedItem}
                recentRows={(stockInQuery.data ?? []).slice(0, 5)}
                itemsLoading={itemsQuery.isLoading}
                customersLoading={customersQuery.isLoading}
                pending={receiveMutation.isPending}
                onCancel={resetEntryForm}
                onSave={() => void receiveMutation.mutateAsync()}
                showRecent={false}
              />
              <OpeningBalancesTable
                rows={openingsQuery.data ?? []}
                items={gasItems}
                loading={openingsQuery.isLoading}
                error={openingsQuery.error}
                deleting={deleteOpeningMutation.isPending}
                onEdit={editOpening}
                onDelete={(id) => void deleteOpeningMutation.mutateAsync(id)}
              />
            </>
          )}
          {activeTab === 'adjust' && (
            <>
              {editingLog?.type === 'adjusted' && <WorkspaceHeader title="Edit Stock Adjustment" subtitle="Update the saved stock adjustment." />}
              <AdjustForm
                date={date}
                setDate={setDate}
                itemId={itemId}
                setItemId={setItemId}
                customerId={customerId}
                setCustomerId={setCustomerId}
                qtyInput={qtyInput}
                setQtyInput={setQtyInput}
                note={note}
                setNote={setNote}
                reason={adjustmentReason}
                setReason={setAdjustmentReason}
                mode={adjustmentMode}
                setMode={setAdjustmentMode}
                items={gasItems}
                customers={customers}
                selectedItem={selectedItem}
                currentStock={selectedBucket?.currentStock ?? 0}
                itemsLoading={itemsQuery.isLoading}
                customersLoading={customersQuery.isLoading}
                pending={adjustmentMutation.isPending}
                onCancel={resetEntryForm}
                onSave={() => void adjustmentMutation.mutateAsync()}
              />
            </>
          )}
          {activeTab === 'report' && (
            <ReportPanel
              month={reportMonth}
              setMonth={setReportMonth}
              rows={stockReportQuery.data ?? []}
              yearRows={fiscalReportRows}
              loading={stockReportQuery.isLoading}
              error={stockReportQuery.error}
              onExport={exportMonthlyCsv}
            />
          )}
        </div>
      </section>

      <section id="stock-logs" className="overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <WorkspaceHeader
          title="Recent Stock Logs"
          subtitle="Review received, sold, adjusted, and closing stock movements."
          actions={<LogsControls search={logSearch} setSearch={setLogSearch} type={logType} setType={setLogType} onExport={exportLogsCsv} disabled={logs.length === 0} />}
        />
        <LogsPanel
          rows={logs}
          stockItems={stockItems}
          loading={recentLogsQuery.isLoading || currentStockQuery.isLoading}
          error={recentLogsQuery.error ?? currentStockQuery.error}
          deleting={deleteReceivedMutation.isPending || deleteAdjustmentMutation.isPending}
          onEdit={editLog}
          onDelete={deleteLog}
        />
      </section>

      {detailItem && (
        <ModalShell title={detailItem.itemName} wide onClose={() => setDetailItem(null)}>
          <ItemDetailContent
            item={detailItem}
            ledgerRows={detailLedgerQuery.data ?? []}
            loading={detailLedgerQuery.isLoading}
            error={detailLedgerQuery.error}
            onReceive={() => {
              setDetailItem(null)
              openReceive(detailItem)
            }}
            onAdjust={() => {
              setDetailItem(null)
              openAdjust(detailItem)
            }}
          />
        </ModalShell>
      )}
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
    queryClient.invalidateQueries({ queryKey: ['recent-stock-logs'] }),
    queryClient.invalidateQueries({ queryKey: ['current-stock'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] }),
    queryClient.invalidateQueries({ queryKey: ['monthly-stock-report'] }),
  ])
}

function ActionButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`${active ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/70 hover:text-slate-950'} inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-300/60`} onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}

function WorkspaceHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-slate-950">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}

function ReportPanel({
  month,
  setMonth,
  rows,
  yearRows,
  loading,
  error,
  onExport,
}: {
  month: string
  setMonth: (value: string) => void
  rows: MonthlyStockReportRow[]
  yearRows: MonthlyStockReportRow[]
  loading: boolean
  error: unknown
  onExport: () => void
}) {
  const [view, setView] = useState<'monthly' | 'yearly' | 'item'>('monthly')
  const activeRows = view === 'yearly' ? aggregateReportRows(yearRows) : rows
  const totals = activeRows.reduce(
    (acc, row) => ({
      opening: acc.opening + row.opening,
      stockIn: acc.stockIn + row.stockIn,
      sold: acc.sold + row.sold,
      adjustment: acc.adjustment + row.adjustment,
      closing: acc.closing + row.closing,
    }),
    { opening: 0, stockIn: 0, sold: 0, adjustment: 0, closing: 0 },
  )
  const sample = activeRows[0] ?? rows[0] ?? yearRows[0]
  return (
    <div>
      <div className="mb-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <ReportMetric label="Opening" qty={totals.opening} item={sample} />
          <ReportMetric label="Received" qty={totals.stockIn} item={sample} />
          <ReportMetric label="Sold" qty={totals.sold} item={sample} />
          <ReportMetric label="Adjusted" qty={totals.adjustment} item={sample} />
          <ReportMetric label="Closing" qty={totals.closing} item={sample} strong />
        </div>
        <div className="grid gap-2 sm:grid-cols-[auto_minmax(180px,1fr)_auto] xl:min-w-[520px]">
          <div className="inline-grid grid-cols-3 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
            <ReportViewButton active={view === 'monthly'} onClick={() => setView('monthly')}>Monthly</ReportViewButton>
            <ReportViewButton active={view === 'yearly'} onClick={() => setView('yearly')}>Yearly</ReportViewButton>
            <ReportViewButton active={view === 'item'} onClick={() => setView('item')}>Item Wise</ReportViewButton>
          </div>
          <input className={`${inputClass} min-w-0`} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => window.print()}>
              <FileText size={16} />
              PDF
            </button>
            <button type="button" className={secondaryButtonClass} onClick={onExport} disabled={rows.length === 0}>
              <Download size={16} />
              Excel
            </button>
          </div>
        </div>
      </div>
      {loading && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading stock report...</p>}
      {Boolean(error) && <ErrorText error={error} fallback="Unable to load stock report." />}
      {!loading && !error && view !== 'item' && <StockReportTable rows={activeRows} />}
      {!loading && !error && view === 'item' && <ItemReportTable rows={rows} />}
    </div>
  )
}

function ReportViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`h-9 rounded px-3 text-sm font-medium transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`} onClick={onClick}>
      {children}
    </button>
  )
}

function ReportMetric({ label, qty, item, strong = false }: { label: string; qty: number; item?: { type?: string; unit?: string; bagWeight?: number }; strong?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <div className={`mt-1 ${strong ? 'text-slate-950' : 'text-slate-700'}`}>
        <StockQtyText qty={qty} item={item} />
      </div>
    </div>
  )
}

function LogsPanel({
  rows,
  stockItems,
  loading,
  error,
  deleting,
  onEdit,
  onDelete,
}: {
  rows: StockLogRow[]
  stockItems: CurrentStockRecord[]
  loading: boolean
  error: unknown
  deleting: boolean
  onEdit: (row: StockLogRow) => void
  onDelete: (row: StockLogRow) => void
}) {
  return (
    <div>
      {loading && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading logs...</p>}
      {Boolean(error) && <ErrorText error={error} fallback="Unable to load logs." />}
      {!loading && !error && <LogsTable rows={rows} stockItems={stockItems} onEdit={onEdit} onDelete={onDelete} deleting={deleting} />}
    </div>
  )
}

function LogsControls({
  search,
  setSearch,
  type,
  setType,
  onExport,
  disabled,
}: {
  search: string
  setSearch: (value: string) => void
  type: 'all' | StockLogType
  setType: (value: 'all' | StockLogType) => void
  onExport: () => void
  disabled: boolean
}) {
  return (
    <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:flex-nowrap md:items-center">
      <label className="relative w-64 max-w-full">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs..." />
      </label>
      <select className={`${inputClass} w-36`} value={type} onChange={(event) => setType(event.target.value as 'all' | StockLogType)}>
        <option value="all">All types</option>
        <option value="received">Received</option>
        <option value="sold">Sold</option>
        <option value="adjusted">Adjusted</option>
      </select>
      <button type="button" className={secondaryButtonClass} onClick={onExport} disabled={disabled}>
        <Download size={16} />
        Export
      </button>
    </div>
  )
}

function ItemDetailContent({
  item,
  ledgerRows,
  loading,
  error,
  onReceive,
  onAdjust,
}: {
  item: CurrentStockRecord
  ledgerRows: StockLedgerRow[]
  loading: boolean
  error: unknown
  onReceive: () => void
  onAdjust: () => void
}) {
  const net = item.stockInThisMonth + item.adjustmentThisMonth - item.soldThisMonth
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DetailMetric label="Current" value={formatBagCount(item.currentStock, item)} sub={formatStockQty(item.currentStock, item)} />
        <DetailMetric label="Received" value={formatBagCount(item.stockInThisMonth, item)} tone="green" />
        <DetailMetric label="Sold" value={formatBagCount(item.soldThisMonth, item)} tone="red" />
        <DetailMetric label="Net" value={formatBagCount(net, item)} tone={net < 0 ? 'red' : net > 0 ? 'green' : 'slate'} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onAdjust}>
          <SlidersHorizontal size={16} />
          Adjust
        </button>
        <button type="button" className={primaryButtonClass} onClick={onReceive}>
          <PackagePlus size={16} />
          Receive
        </button>
      </div>
      <div>
        <h4 className="mb-3 text-sm font-semibold text-slate-900">Full Ledger</h4>
        {loading && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading ledger...</p>}
        {Boolean(error) && <ErrorText error={error} fallback="Unable to load ledger." />}
        {!loading && !error && <LedgerTable rows={ledgerRows} item={item} />}
      </div>
    </div>
  )
}

function DetailMetric({ label, value, sub, tone = 'slate' }: { label: string; value: string; sub?: string; tone?: 'slate' | 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : 'text-slate-950'
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 font-mono text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function ReceiveForm({
  date,
  setDate,
  itemId,
  setItemId,
  customerId,
  setCustomerId,
  qtyInput,
  setQtyInput,
  note,
  setNote,
  items,
  customers,
  selectedItem,
  recentRows,
  itemsLoading,
  customersLoading,
  pending,
  onCancel,
  onSave,
  showRecent = true,
}: {
  date: string
  setDate: (value: string) => void
  itemId: string
  setItemId: (value: string) => void
  customerId: string
  setCustomerId: (value: string) => void
  qtyInput: string
  setQtyInput: (value: string) => void
  note: string
  setNote: (value: string) => void
  items: Array<{ id: string; name: string }>
  customers: StockCustomerOption[]
  selectedItem?: { unit: string; type?: string; bagWeight?: number } | null
  recentRows: StockInRecord[]
  itemsLoading: boolean
  customersLoading: boolean
  pending: boolean
  onCancel: () => void
  onSave: () => void
  showRecent?: boolean
}) {
  return (
    <>
      <StockEntryFields
        date={date}
        setDate={setDate}
        itemId={itemId}
        setItemId={setItemId}
        customerId={customerId}
        setCustomerId={setCustomerId}
        qtyInput={qtyInput}
        setQtyInput={setQtyInput}
        note={note}
        setNote={setNote}
        items={items}
        customers={customers}
        itemsLoading={itemsLoading}
        customersLoading={customersLoading}
        notePlaceholder="Production batch, source, or remark"
        actions={<FormActions onCancel={onCancel} onSave={onSave} pending={pending} disabled={!itemId || !customerId || parseStockQtyInput(qtyInput, selectedItem) <= 0} saveText="Save" />}
      />
      {showRecent && <RecentReceived rows={recentRows} items={items} />}
    </>
  )
}

function AdjustForm({
  date,
  setDate,
  itemId,
  setItemId,
  customerId,
  setCustomerId,
  qtyInput,
  setQtyInput,
  note,
  setNote,
  reason,
  setReason,
  mode,
  setMode,
  items,
  customers,
  selectedItem,
  currentStock,
  itemsLoading,
  customersLoading,
  pending,
  onCancel,
  onSave,
}: {
  date: string
  setDate: (value: string) => void
  itemId: string
  setItemId: (value: string) => void
  customerId: string
  setCustomerId: (value: string) => void
  qtyInput: string
  setQtyInput: (value: string) => void
  note: string
  setNote: (value: string) => void
  reason: string
  setReason: (value: string) => void
  mode: AdjustmentMode
  setMode: (value: AdjustmentMode) => void
  items: Array<{ id: string; name: string }>
  customers: StockCustomerOption[]
  selectedItem?: { unit: string; type?: string; bagWeight?: number } | null
  currentStock: number
  itemsLoading: boolean
  customersLoading: boolean
  pending: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <>
      <div className="mb-3 inline-grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1 md:w-[420px]">
        <ModeButton active={mode === 'add'} onClick={() => setMode('add')}>Add</ModeButton>
        <ModeButton active={mode === 'subtract'} onClick={() => setMode('subtract')}>Subtract</ModeButton>
        <ModeButton active={mode === 'set'} onClick={() => setMode('set')}>Set</ModeButton>
      </div>
      {itemId && (
        <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Current stock: <span className="font-mono font-semibold text-slate-900"><StockQtyText qty={currentStock} item={selectedItem} /></span>
        </p>
      )}
      <StockEntryFields
        date={date}
        setDate={setDate}
        itemId={itemId}
        setItemId={setItemId}
        customerId={customerId}
        setCustomerId={setCustomerId}
        qtyInput={qtyInput}
        setQtyInput={setQtyInput}
        note={note}
        setNote={setNote}
        items={items}
        customers={customers}
        itemsLoading={itemsLoading}
        customersLoading={customersLoading}
        qtyLabel={mode === 'set' ? `Set To (${unitLabel(selectedItem)})` : `Quantity (${unitLabel(selectedItem)})`}
        notePlaceholder="Extra remark"
        actions={<FormActions onCancel={onCancel} onSave={onSave} pending={pending} disabled={!itemId || !customerId || parseStockQtyInput(qtyInput, selectedItem) <= 0} saveText="Save Adjustment" />}
      />
      <div className="mt-3 max-w-xl">
        <Field label="Reason">
          <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Damage, correction, physical count" />
        </Field>
      </div>
    </>
  )
}

function RecentReceived({ rows, items }: { rows: StockInRecord[]; items: Array<{ id: string; name: string; type?: string; unit?: string; bagWeight?: number }> }) {
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Recent Received Stock</h4>
        <span className="text-xs text-slate-500">{rows.length} latest</span>
      </div>
      <div className={tableShellClass}>
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="bg-slate-50">
              <Th>Date</Th>
              <Th>Item</Th>
              <Th>Party</Th>
              <Th right>Qty</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} text="No recent stock receipts." />}
            {rows.map((row, index) => (
              <tr key={row.id} className={tableRowClass(index)}>
                <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
                <Td strong>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono><StockQtyText qty={row.qty} item={items.find((item) => item.id === row.itemId || item.name === row.itemName)} /></Td>
                <Td>{row.note || '-'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OpeningBalancesTable({
  rows,
  items,
  loading,
  error,
  deleting,
  onEdit,
  onDelete,
}: {
  rows: StockOpeningRecord[]
  items: Array<{ id: string; name: string; type?: string; unit?: string; bagWeight?: number }>
  loading: boolean
  error: unknown
  deleting: boolean
  onEdit: (row: StockOpeningRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Opening Balances</h4>
        <span className="text-xs text-slate-500">{rows.length} entries</span>
      </div>
      {loading && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading opening balances...</p>}
      {Boolean(error) && <ErrorText error={error} fallback="Unable to load opening balances." />}
      {!loading && !error && (
        <div className={tableShellClass}>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-slate-50">
                <Th>Date</Th>
                <Th>Item</Th>
                <Th>Party</Th>
                <Th right>Opening</Th>
                <Th>Note</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6} text="No opening balances set." />}
              {rows.map((row, index) => (
                <tr key={row.id} className={tableRowClass(index)}>
                  <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
                  <Td strong>{row.itemName}</Td>
                  <Td>{row.customerName}</Td>
                  <Td right mono><StockQtyText qty={row.qty} item={items.find((item) => item.id === row.itemId || item.name === row.itemName)} /></Td>
                  <Td>{row.note || '-'}</Td>
                  <Td right>
                    <div className="inline-flex gap-2">
                      <button type="button" className={rowActionButtonClass} onClick={() => onEdit(row)}>Edit</button>
                      <button type="button" className={rowDeleteButtonClass} onClick={() => onDelete(row.id)} disabled={deleting}>Delete</button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StockEntryFields({
  date,
  setDate,
  itemId,
  setItemId,
  customerId,
  setCustomerId,
  qtyInput,
  setQtyInput,
  note,
  setNote,
  items,
  customers,
  itemsLoading,
  customersLoading,
  qtyLabel,
  notePlaceholder,
  actions,
}: {
  date: string
  setDate: (value: string) => void
  itemId: string
  setItemId: (value: string) => void
  customerId: string
  setCustomerId: (value: string) => void
  qtyInput: string
  setQtyInput: (value: string) => void
  note: string
  setNote: (value: string) => void
  items: Array<{ id: string; name: string }>
  customers: StockCustomerOption[]
  itemsLoading: boolean
  customersLoading: boolean
  qtyLabel?: string
  notePlaceholder: string
  actions?: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 xl:grid-cols-[130px_minmax(170px,1fr)_minmax(170px,1fr)_120px_minmax(180px,1fr)_auto]">
      <Field label="Date">
        <DateInput className={inputClass} value={date} onChange={setDate} />
      </Field>
      <Field label="Item">
        <SearchableCombobox
          options={items}
          value={itemId}
          onChange={setItemId}
          inputClassName={inputClass}
          placeholder={itemsLoading ? 'Loading items...' : 'Search item...'}
          disabled={itemsLoading}
          emptyText="No matching gas part found."
          maxResults={25}
        />
      </Field>
      <Field label="Party">
        <SearchableCombobox
          options={customers}
          value={customerId}
          onChange={setCustomerId}
          inputClassName={inputClass}
          placeholder={customersLoading ? 'Loading parties...' : 'Search party...'}
          disabled={customersLoading}
          emptyText="No matching party found."
          maxResults={25}
        />
      </Field>
      <div>
        <Field label={qtyLabel ?? 'Quantity'}>
          <input className={inputClass} value={qtyInput} onChange={(event) => setQtyInput(event.target.value)} placeholder="5 or 250 kg" />
        </Field>
      </div>
      <div>
        <Field label="Notes">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder={notePlaceholder} />
        </Field>
      </div>
      {actions && <div className="flex items-end justify-end gap-2">{actions}</div>}
    </div>
  )
}

function FormActions({ onCancel, onSave, pending, disabled, saveText }: { onCancel: () => void; onSave: () => void; pending: boolean; disabled: boolean; saveText: string }) {
  return (
    <>
      <button type="button" className={secondaryButtonClass} onClick={onCancel}>Clear</button>
      <button type="button" className={primaryButtonClass} onClick={onSave} disabled={disabled || pending}>
        <PackagePlus size={16} />
        {pending ? 'Saving...' : saveText}
      </button>
    </>
  )
}

function ModalShell({ title, wide = false, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
      <div className={`max-h-[92vh] w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`h-9 rounded-[5px] px-3 text-sm font-medium transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`} onClick={onClick}>
      {children}
    </button>
  )
}

function StockReportTable({ rows }: { rows: MonthlyStockReportRow[] }) {
  return (
    <div className={tableShellClass}>
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
          {rows.map((row, index) => (
            <tr key={row.id} className={tableRowClass(index)}>
              <Td strong>{row.itemName}</Td>
              <Td>{row.customerName}</Td>
              <Td right mono><StockQtyText qty={row.opening} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.stockIn} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.sold} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.adjustment} item={row} /></Td>
              <Td right mono strong><StockQtyText qty={row.closing} item={row} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemReportTable({ rows }: { rows: MonthlyStockReportRow[] }) {
  const itemRows = aggregateItemReportRows(rows)
  return (
    <div className={tableShellClass}>
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Item</Th>
            <Th right>Opening</Th>
            <Th right>Received</Th>
            <Th right>Sold</Th>
            <Th right>Adjusted</Th>
            <Th right>Closing</Th>
            <Th right>Movement</Th>
          </tr>
        </thead>
        <tbody>
          {itemRows.length === 0 && <EmptyRow colSpan={7} text="No item movement for this month." />}
          {itemRows.map((row, index) => (
            <tr key={row.id} className={tableRowClass(index)}>
              <Td strong>{row.itemName}</Td>
              <Td right mono><StockQtyText qty={row.opening} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.stockIn} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.sold} item={row} /></Td>
              <Td right mono><StockQtyText qty={row.adjustment} item={row} /></Td>
              <Td right mono strong><StockQtyText qty={row.closing} item={row} /></Td>
              <Td right mono>{formatPercent(row.opening ? ((row.closing - row.opening) / Math.abs(row.opening)) * 100 : row.closing ? 100 : 0)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LedgerTable({ rows, item }: { rows: StockLedgerRow[]; item?: CurrentStockRecord }) {
  return (
    <div className={tableShellClass}>
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Date</Th>
            <Th>Type</Th>
            <Th right>In</Th>
            <Th right>Out</Th>
            <Th right>Balance</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} text="No ledger movement found." />}
          {rows.map((row, index) => (
            <tr key={row.id} className={tableRowClass(index)}>
              <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
              <Td strong>{row.type}</Td>
              <Td right mono>{row.inQty ? <StockQtyText qty={row.inQty} item={item} /> : '-'}</Td>
              <Td right mono>{row.outQty ? <StockQtyText qty={row.outQty} item={item} /> : '-'}</Td>
              <Td right mono><StockQtyText qty={row.balance} item={item} /></Td>
              <Td>{row.note || '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LogsTable({
  rows,
  stockItems,
  onEdit,
  onDelete,
  deleting,
}: {
  rows: StockLogRow[]
  stockItems: CurrentStockRecord[]
  onEdit: (row: StockLogRow) => void
  onDelete: (row: StockLogRow) => void
  deleting: boolean
}) {
  return (
    <div className={tableShellClass}>
      <table className="w-full min-w-[920px]">
        <thead>
          <tr className="bg-slate-50">
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Item</Th>
            <Th>Party</Th>
            <Th right>Received</Th>
            <Th right>Sold</Th>
            <Th right>Balance</Th>
            <Th>Note</Th>
            <Th right>Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={9} text="No stock logs found." />}
          {rows.map((row, index) => {
            const item = stockItems.find((stockItem) => stockItem.itemId === row.itemId && stockItem.customerId === row.customerId) ?? stockItems.find((stockItem) => stockItem.itemName === row.itemName)
            const readOnly = row.type === 'sold'
            return (
              <tr key={row.id} className={tableRowClass(index)}>
                <Td>{row.date ? formatFullDate(row.date) : '-'}</Td>
                <Td><StockLogTypeBadge type={row.type} /></Td>
                <Td>{row.itemName}</Td>
                <Td>{row.customerName}</Td>
                <Td right mono>{row.inQty ? <StockQtyText qty={row.inQty} item={item} /> : '-'}</Td>
                <Td right mono>{row.outQty ? <StockQtyText qty={row.outQty} item={item} /> : '-'}</Td>
                <Td right mono strong><StockQtyText qty={row.balance} item={item} /></Td>
                <Td>{row.note || '-'}</Td>
                <Td right>
                  <div className="inline-flex gap-2">
                    {readOnly ? (
                      <span className="text-xs font-medium text-slate-400">From bill</span>
                    ) : (
                      <>
                        <button type="button" className={rowActionButtonClass} onClick={() => onEdit(row)}>Edit</button>
                        <button type="button" className={rowDeleteButtonClass} onClick={() => onDelete(row)} disabled={deleting}>Delete</button>
                      </>
                    )}
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

function mapRecentStockLog(row: RecentStockLogRecord): StockLogRow {
  return {
    id: row.id,
    rawId: row.rawId,
    itemId: row.itemId,
    customerId: row.customerId,
    type: row.editableType,
    date: row.date,
    itemName: row.itemName,
    customerName: row.customerName,
    inQty: row.inQty,
    outQty: row.outQty,
    balance: row.balance,
    note: row.note,
  }
}

function findGeneralCustomer(customers: StockCustomerOption[]) {
  return customers.find((customer) => customer.customerName.toLowerCase() === 'general' || customer.companyName.toLowerCase() === 'general')
}

function StockLogTypeBadge({ type }: { type: StockLogRow['type'] }) {
  const typeClass =
    type === 'received'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : type === 'sold'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${typeClass}`}>{type === 'received' ? 'Received' : type === 'sold' ? 'Sold' : 'Adjusted'}</span>
}

function adjustmentQty(inputQty: number, mode: AdjustmentMode, currentStock: number) {
  if (mode === 'subtract') return -inputQty
  if (mode === 'set') return inputQty - currentStock
  return inputQty
}

function kgToBags(value: number, item?: { type?: string; bagWeight?: number } | null) {
  if (item?.type !== 'gas') return value
  return value / (item.bagWeight || 50)
}

function parseStockQtyInput(raw: string, item?: { type?: string; bagWeight?: number } | null) {
  const value = Number(String(raw).toLowerCase().replace(/[^0-9. -]/g, ''))
  if (!Number.isFinite(value) || value <= 0) return 0
  const isKg = /\bkg|kgs|kilo|kilogram/.test(String(raw).toLowerCase())
  if (item?.type === 'gas' && !isKg) return value * (item.bagWeight || 50)
  return value
}

function aggregateReportRows(rows: MonthlyStockReportRow[]) {
  const byBucket = new Map<string, MonthlyStockReportRow>()
  for (const row of rows) {
    const key = `${row.itemId || row.itemName}::${row.customerId || row.customerName}`
    const existing = byBucket.get(key)
    if (!existing) {
      byBucket.set(key, { ...row })
      continue
    }
    existing.opening += row.opening
    existing.stockIn += row.stockIn
    existing.sold += row.sold
    existing.adjustment += row.adjustment
    existing.closing += row.closing
  }
  return [...byBucket.values()].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName))
}

function buildFiscalReportRows(monthRows: MonthlyStockReportRow[][]) {
  const byBucket = new Map<string, MonthlyStockReportRow>()
  for (const rows of monthRows) {
    for (const row of rows) {
      const key = `${row.itemId || row.itemName}::${row.customerId || row.customerName}`
      const existing = byBucket.get(key)
      if (!existing) {
        byBucket.set(key, { ...row })
        continue
      }
      existing.stockIn += row.stockIn
      existing.sold += row.sold
      existing.adjustment += row.adjustment
      existing.closing = row.closing
    }
  }
  return [...byBucket.values()].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName))
}

function aggregateItemReportRows(rows: MonthlyStockReportRow[]) {
  const byItem = new Map<string, MonthlyStockReportRow>()
  for (const row of rows) {
    const key = row.itemId || row.itemName
    const existing = byItem.get(key)
    if (!existing) {
      byItem.set(key, { ...row, id: `item-${key}`, customerName: 'All parties' })
      continue
    }
    existing.opening += row.opening
    existing.stockIn += row.stockIn
    existing.sold += row.sold
    existing.adjustment += row.adjustment
    existing.closing += row.closing
  }
  return [...byItem.values()].sort((a, b) => a.itemName.localeCompare(b.itemName))
}

function fiscalYearMonthKeys(today: string) {
  const [yearRaw, monthRaw] = today.slice(0, 7).split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const startYear = month >= 4 ? year : year - 1
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(startYear, 3 + index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

function previousMonthKey(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const date = new Date(Number(yearRaw), Number(monthRaw) - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
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
  return <th className={`border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, right = false, mono = false, strong = false }: { children: ReactNode; right?: boolean; mono?: boolean; strong?: boolean }) {
  return <td className={`px-3 py-2.5 text-sm text-slate-700 ${right ? 'text-right' : ''} ${mono ? 'font-mono' : ''} ${strong ? 'font-medium text-slate-900' : ''}`}>{children}</td>
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-slate-500">{text}</td>
    </tr>
  )
}

function unitLabel(item?: { unit: string } | null) {
  if (!item?.unit) return 'kg'
  return item.unit === 'piece' ? 'pieces' : item.unit
}

function formatBagCount(qty: number, item?: { type?: string; bagWeight?: number } | null) {
  if (item?.type !== 'gas') return formatInQty(qty, 'kg')
  const bagWeight = item.bagWeight || 50
  const bags = qty / bagWeight
  return `${bags.toFixed(Number.isInteger(bags) ? 0 : 1)} bags`
}

function formatStockQty(qty: number, item?: { type?: string; unit?: string; bagWeight?: number } | null) {
  if (item?.type === 'gas') return formatInQty(qty, 'kg')
  return formatInQty(qty, unitLabel(item ? { unit: item.unit ?? '' } : null))
}

function StockQtyText({ qty, item }: { qty: number; item?: { type?: string; unit?: string; bagWeight?: number } | null }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-sm font-semibold text-slate-800">{formatBagCount(qty, item)}</span>
      <span className="font-mono text-[11px] text-slate-500">{formatStockQty(qty, item)}</span>
    </span>
  )
}

function formatPercent(value: number) {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`
}

const primaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'

const tableShellClass = 'overflow-x-auto rounded-md border border-slate-200 no-scrollbar'

const rowActionButtonClass =
  'min-h-9 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100'

const rowDeleteButtonClass =
  'min-h-9 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:opacity-60'

function tableRowClass(index: number) {
  return `border-t border-slate-100 transition hover:bg-blue-50/50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
