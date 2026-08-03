import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { invalidateAfterPaymentWrite } from '@/app/query-invalidation'
import { assertBillNumberAvailable, getCustomerBookSelection, getNextBillNoForBook, saveBillWithItems } from '@/data/bills'
import { bookNoForBillNo, getBookRange, isBillNoInBook } from '@/domain/bill-books'
import { savePayment } from '@/data/payments'
import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase, calculateBillTotals } from '@/domain/billing-calculations'
import {
  calculateBillingLineBags,
  calculateGasDefaultRateFromFinal,
  calculateGasFinalRate,
  getBillingItemType,
  getBillingUnit,
  isGasBillingItem,
  suggestBillingRate,
  type BillingGstMode,
} from '@/domain/billing-modes'
import { computeNetBalance, isOnOrBeforeDay } from '@/domain/financial-math'
import { dedupeBillPreviewCredits } from '@/domain/bill-preview'
import { loadSavedMarketRateForDate, useMarketRate } from '@/domain/market-rate'
import { PENDING_COMMAND_STORAGE_KEY, parseContextCommand } from '@/lib/commands'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatCompanyName, formatCustomerDisplayName } from '@/lib/customer-display'
import {
  BILL_PREVIEW_CARD_CLASS,
  BILL_PRINT_DOCUMENT_TITLE,
  downloadBillLayoutAsJpg,
  printBillLayoutFromElement,
  shareBillLayoutImageWithWhatsAppFallback,
} from '@/lib/bill-print-export'
import { formatInQty, formatInrInteger, parseBillQuickPaymentAmountInput, parseNonNegativeNumber, parsePositiveIntInput } from '@/lib/inr-format'

export const Route = createFileRoute('/new-bill')({
  component: NewBillPage,
})

type CustomerOption = { id: string; name: string; companyName: string; customerName: string }
type ItemOption = { id: string; name: string; defaultRate: number; type: string; unit: string; bagWeight: number }
type BillItemRow = {
  itemId: string
  itemName: string
  qty: number
  defaultRate: number
  rate: number
  manualRateEdited: boolean
  type: string
  unit: string
  bagWeight: number
}
type GstMode = 'none' | 'percent18' | 'manual'
type CreditAdjustment = { id: string; date: string; amount: number }
type QuickPaymentRow = { id: string; date: string; amount: number; amountInput: string; mode: 'Cash' | 'Bank'; note: string }
type AutoBalanceContext = { previousBalanceDate: string; previousBalanceAmount: number; credits: CreditAdjustment[] }
type LastCustomerItemRate = { rate: number; mktRate: number; gstRate: number; date: string; billRef: string }
type PBRecord = Record<string, unknown> & { id: string }
const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)
const toTs = (v: unknown) => {
  const ts = new Date(String(v ?? '')).getTime()
  return Number.isFinite(ts) ? ts : 0
}
const COMPANY_NAME = 'Kapil Products'
const submitRowSchema = z.object({
  itemName: z.string().trim().min(1),
  qty: z.number().positive(),
  rate: z.number().positive(),
})

const submitBillSchema = z.object({
  customerId: z.string().trim().min(1, 'Please select a customer'),
  bookNo: z.number().int().positive('Book No is required'),
  billNo: z.number().int().positive('Bill No is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid bill date'),
  items: z.array(submitRowSchema).min(1, 'Add at least one valid item row'),
})

const quickPaymentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid payment date'),
  amount: z.number().positive('Payment amount must be greater than zero'),
  mode: z.enum(['Cash', 'Bank']),
  note: z.string().optional(),
})

function newQuickPaymentRow(date: string): QuickPaymentRow {
  return {
    id: `quick-payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    amount: 0,
    amountInput: '',
    mode: 'Cash',
    note: '',
  }
}

function newBillItemRow(): BillItemRow {
  return { itemId: '', itemName: '', qty: 0, defaultRate: 0, rate: 0, manualRateEdited: false, type: '', unit: '', bagWeight: 50 }
}

const itemKey = (value: unknown) => String(value ?? '').trim().toLowerCase()

function rateMapKeys(item: Pick<ItemOption, 'id' | 'name'>) {
  return [item.id, itemKey(item.name)].filter(Boolean)
}

function formatBillQtySummary(gasQty: number, electronicQty: number) {
  if (gasQty > 0 && electronicQty > 0) return `${formatInQty(gasQty, 'kg')} / ${Math.round(electronicQty)} pcs`
  if (electronicQty > 0) return `${Math.round(electronicQty)} pcs`
  return formatInQty(gasQty, 'kg')
}

async function loadCustomerLastItemRates(customerId: string): Promise<Record<string, LastCustomerItemRate>> {
  const [billsRaw, billItemsRaw] = await Promise.all([
    pb.collection('bills').getFullList({
      sort: 'date,created,bill_no',
      filter: `customer = "${customerId}"`,
    }),
    pb.collection('bill_items').getFullList({ filter: `bill.customer = "${customerId}"` }),
  ])
  const billById = new Map((billsRaw as PBRecord[]).map((bill) => [bill.id, bill]))
  const out: Record<string, LastCustomerItemRate> = {}

  for (const row of billItemsRaw as PBRecord[]) {
    const billId = String(row.bill ?? '')
    const bill = billById.get(billId)
    if (!bill) continue
    const next: LastCustomerItemRate = {
      rate: num(row.rate),
      mktRate: num(bill.mkt),
      gstRate: num(bill.gst_rate),
      date: datePart(bill.date),
      billRef: String(bill.bill_ref ?? `${num(bill.book_no)}/${num(bill.bill_no)}`),
    }
    const keys = [String(row.item ?? ''), itemKey(row.item_name)].filter(Boolean)
    for (const key of keys) {
      const current = out[key]
      if (!current || next.date > current.date) out[key] = next
    }
  }

  return out
}

function findLastRateForItem(rateMap: Record<string, LastCustomerItemRate>, item: Pick<ItemOption, 'id' | 'name'>) {
  for (const key of rateMapKeys(item)) {
    const found = rateMap[key]
    if (found) return found
  }
  return null
}

function NewBillPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [bookNo, setBookNo] = useState<number>(51)
  const [billNo, setBillNo] = useState<number>(1)
  const [date, setDate] = useState(today)
  const [customerId, setCustomerId] = useState('')
  const [mktRate, setMktRate] = useState<number>(0)
  const [transport, setTransport] = useState<number>(0)
  const [gstMode, setGstMode] = useState<GstMode>('none')
  const [manualGstAmount, setManualGstAmount] = useState<number>(0)
  const gstRate = gstMode === 'percent18' ? 18 : 0
  const [lrInput, setLrInput] = useState('')
  const [lrList, setLrList] = useState<string[]>([])
  const [rows, setRows] = useState<BillItemRow[]>([newBillItemRow()])
  const [statusText, setStatusText] = useState('')
  const [bookSelectionWarning, setBookSelectionWarning] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false)
  const [marketPillOpen, setMarketPillOpen] = useState(false)
  const [quickPayments, setQuickPayments] = useState<QuickPaymentRow[]>([])
  const [quickCommandInput, setQuickCommandInput] = useState('')
  const [pendingCommandPreview, setPendingCommandPreview] = useState(false)
  const [previewBalanceSnapshot, setPreviewBalanceSnapshot] = useState<AutoBalanceContext | null>(null)
  const { marketRate, refreshMarketRate } = useMarketRate(date)
  const billNoInitializedRef = useRef(false)
  const manualBookRef = useRef(false)
  const manualBillNoRef = useRef(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const customersQuery = useQuery({
    queryKey: ['customers-options'],
    queryFn: async (): Promise<CustomerOption[]> => {
      const records = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
      return records.map((r) => {
        const customerName = String(r.name ?? '')
        const companyName = formatCompanyName(r.company_name, r.name)
        return {
          id: r.id,
          name: formatCustomerDisplayName(companyName, customerName),
          companyName,
          customerName,
        }
      })
    },
  })

  const itemsQuery = useQuery({
    queryKey: ['items-options'],
    queryFn: async (): Promise<ItemOption[]> => {
      const records = await pb.collection('items').getFullList({ sort: 'name' })
      return records.map((r) => ({
        id: r.id,
        name: String(r.name ?? ''),
        defaultRate: Number(r.default_rate ?? 0),
        type: String(r.type ?? ''),
        unit: String(r.unit ?? ''),
        bagWeight: Number(r.bag_weight ?? 50),
      }))
    },
  })
  const nextBillNoQuery = useQuery({
    queryKey: ['next-bill-no', bookNo],
    queryFn: () => getNextBillNoForBook(bookNo),
    enabled: bookNo > 0,
  })
  const customerBookQuery = useQuery({
    queryKey: ['customer-book-selection', customerId],
    queryFn: () => getCustomerBookSelection(customerId),
    enabled: Boolean(customerId),
  })
  // `null` means every number in the book is used; fall back to the book start so the field stays usable.
  const isBookFull = !nextBillNoQuery.isLoading && nextBillNoQuery.data === null
  const resolvedNextBillNo = nextBillNoQuery.data ?? getBookRange(bookNo).firstBillNo
  // Warnings only — routine info like the book's range or next number would be noise.
  const billNoHint = useMemo((): { text?: string; tone: 'muted' | 'warning' } => {
    if (bookNo <= 0) return { tone: 'muted' }
    if (isBookFull) return { text: `Book ${bookNo} is finished — start the next book`, tone: 'warning' }
    if (billNo > 0 && !isBillNoInBook(bookNo, billNo)) {
      return { text: `Bill ${billNo} belongs to book ${bookNoForBillNo(billNo)}, not book ${bookNo}`, tone: 'warning' }
    }
    return { tone: 'muted' }
  }, [billNo, bookNo, isBookFull])
  const autoBalanceQuery = useQuery({
    queryKey: ['customer-auto-balance', customerId, date],
    enabled: Boolean(customerId && date),
    queryFn: async (): Promise<AutoBalanceContext> => {
      const [billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
        pb.collection('bills').getFullList({
          sort: 'date,bill_no',
          filter: `customer = "${customerId}"`,
        }),
        pb.collection('bill_items').getFullList({ filter: `bill.customer = "${customerId}"` }),
        pb.collection('payments').getFullList({
          sort: 'date',
          filter: `customer = "${customerId}"`,
        }),
      ])
      const customerRecord = await pb.collection('customers').getOne(customerId)

      const bills = (billsRaw as PBRecord[])
        .filter((bill) => datePart(bill.date) <= date)
        .sort((a, b) => {
          const d = datePart(a.date).localeCompare(datePart(b.date))
          if (d !== 0) return d
          const c = toTs(a.created) - toTs(b.created)
          if (c !== 0) return c
          return String(a.id).localeCompare(String(b.id))
        })
      const billItems = billItemsRaw as PBRecord[]
      const payments = (paymentsRaw as PBRecord[])
        .filter((payment) => datePart(payment.date) <= date)
        .map((payment) => ({
          date: datePart(payment.date),
          amount: num(payment.amount),
          createdTs: toTs(payment.created),
          id: String(payment.id),
        }))
      const openingBalance = num(customerRecord.opening_balance)

      const priorBills = bills.filter((bill) => datePart(bill.date) < date)
      if (priorBills.length === 0) {
        const openingCredits = payments.filter((entry) => entry.amount > 0)
        return { previousBalanceDate: 'Opening', previousBalanceAmount: openingBalance, credits: openingCredits }
      }

      const itemTotalByBill = new Map<string, number>()
      for (const row of billItems) {
        const billId = String(row.bill ?? '')
        itemTotalByBill.set(billId, (itemTotalByBill.get(billId) ?? 0) + num(row.amount))
      }

      const lastBill = priorBills[priorBills.length - 1]
      const lastBillDate = datePart(lastBill.date)
      const lastBillCreatedTs = toTs(lastBill.created)
      const billTotals = priorBills.map((bill) => ({
        date: datePart(bill.date),
        total: calculateBillTotalFromBase(itemTotalByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
      }))

      const billedUntilLastBill = billTotals.reduce((sum, entry) => sum + entry.total, 0)
      const paidUntilLastBill = payments
        .filter((entry) => {
          if (entry.date < lastBillDate) return true
          if (entry.date > lastBillDate) return false
          // Same bill day: include only payments entered up to last bill creation time.
          if (entry.createdTs > 0 && lastBillCreatedTs > 0) return entry.createdTs <= lastBillCreatedTs
          return true
        })
        .reduce((sum, entry) => sum + entry.amount, 0)
      const previousBalanceAmount = computeNetBalance(openingBalance, billedUntilLastBill, paidUntilLastBill)
      const credits = payments.filter(
        (entry) =>
          entry.amount > 0 &&
          // Credit should be after last bill cutoff.
          (entry.date > lastBillDate ||
            // Same-day: only a payment provably entered after the bill counts as
            // a credit. Unknown timestamps already sit inside previousBalance —
            // listing them here again would subtract them twice.
            (entry.date === lastBillDate && entry.createdTs > 0 && lastBillCreatedTs > 0 && entry.createdTs > lastBillCreatedTs)) &&
          isOnOrBeforeDay(entry.date, date),
      )

      return {
        previousBalanceDate: lastBillDate || date,
        previousBalanceAmount,
        credits,
      }
    },
  })

  const customerLastRatesQuery = useQuery({
    queryKey: ['customer-last-item-rates', customerId],
    enabled: Boolean(customerId),
    queryFn: () => loadCustomerLastItemRates(customerId),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const customer = (customersQuery.data ?? []).find((c) => c.id === customerId)
      if (!customer) throw new Error('Please select a customer')
      const validRows = rows.filter((r) => r.itemName.trim() && r.qty > 0 && r.rate > 0)
      const validQuickPayments = quickPayments.filter((payment) => payment.amount > 0)
      const parsed = submitBillSchema.safeParse({
        customerId,
        bookNo,
        billNo,
        date,
        items: validRows.map((row) => ({ itemId: row.itemId, itemName: row.itemName, qty: row.qty, rate: row.rate, manualRateEdited: row.manualRateEdited })),
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Bill validation failed')
      }
      for (const payment of validQuickPayments) {
        const parsedPayment = quickPaymentSchema.safeParse(payment)
        if (!parsedPayment.success) {
          throw new Error(parsedPayment.error.issues[0]?.message ?? 'Quick payment validation failed')
        }
      }

      await saveBillWithItems({
        bookNo,
        billNo,
        date,
        customerId: customer.id,
        customerName: customer.companyName,
        mktRate,
        transport,
        gstRate,
        gstAmount,
        lrList,
        items: validRows,
      })
      for (const payment of validQuickPayments) {
        await savePayment({
          customerId: customer.id,
          customerName: customer.companyName,
          date: payment.date,
          amount: payment.amount,
          mode: payment.mode,
          note: payment.note || `Quick payment with bill ${bookNo}/${billNo}`,
        })
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions-page'] }),
        queryClient.invalidateQueries({ queryKey: ['customers-ledger'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-ledger-context'] }),
        queryClient.invalidateQueries({ queryKey: ['next-bill-no'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-auto-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-data'] }),
        customerId ? invalidateAfterPaymentWrite(queryClient, customerId) : Promise.resolve(),
      ])
      const savedQuickPaymentCount = quickPayments.filter((payment) => payment.amount > 0).length
      setStatusText(savedQuickPaymentCount > 0 ? `Bill saved with ${savedQuickPaymentCount} quick payment${savedQuickPaymentCount === 1 ? '' : 's'}` : 'Bill saved successfully')
      resetForm()
    },
    onError: (err) => {
      setStatusText(toUserMessage(err))
    },
  })

  const totals = calculateBillTotals({
    items: rows,
    transport,
    gstRate,
    gstAmountOverride: gstMode === 'manual' ? manualGstAmount : null,
  })
  const { totalQty, itemsTotal, gstAmount, grandTotal } = totals

  const helperStatusText = useMemo(() => {
    if (statusText) return statusText
    const hasCustomer = Boolean(customerId)
    const hasValidRow = rows.some((r) => r.itemName && r.qty > 0 && r.rate > 0)
    return hasCustomer && hasValidRow ? 'Ready to save' : 'Fill required fields to save'
  }, [statusText, customerId, rows])
  const selectedCustomerName = (customersQuery.data ?? []).find((c) => c.id === customerId)?.companyName ?? 'Unknown'
  const customerBillingType = useMemo(() => {
    if (!customerId) return 'mixed' as const
    const rateMap = customerLastRatesQuery.data ?? {}
    const items = itemsQuery.data ?? []
    let gas = 0
    let electronic = 0
    for (const item of items) {
      const hasHistory = rateMapKeys(item).some((key) => Boolean(rateMap[key]))
      if (!hasHistory) continue
      if (getBillingItemType(item) === 'electronic') electronic += 1
      else gas += 1
    }
    if (gas > 0 && electronic === 0) return 'gas' as const
    if (electronic > 0 && gas === 0) return 'electronic' as const
    return 'mixed' as const
  }, [customerId, customerLastRatesQuery.data, itemsQuery.data])
  const availableItems = useMemo(() => {
    const items = itemsQuery.data ?? []
    if (customerBillingType === 'mixed') return items
    return items.filter((item) => getBillingItemType(item) === customerBillingType)
  }, [customerBillingType, itemsQuery.data])
  const validRows = rows.filter((r) => r.itemName.trim() && r.qty > 0 && r.rate > 0)
  const gasQty = validRows.filter(isGasBillingItem).reduce((sum, row) => sum + row.qty, 0)
  const electronicQty = validRows.filter((row) => !isGasBillingItem(row)).reduce((sum, row) => sum + row.qty, 0)
  const qtySummary = formatBillQtySummary(gasQty, electronicQty)
  const previousBalanceDate = autoBalanceQuery.data?.previousBalanceDate ?? date
  const activeBalance = previewBalanceSnapshot ?? autoBalanceQuery.data
  const activePreviousBalanceDate = activeBalance?.previousBalanceDate ?? date
  const previousBalanceAmount = activeBalance?.previousBalanceAmount ?? 0
  const validCredits = (activeBalance?.credits ?? []).filter((entry) => entry.amount > 0)
  const totalCredits = validCredits.reduce((sum, entry) => sum + entry.amount, 0)
  const validQuickPayments = quickPayments.filter((payment) => payment.amount > 0)
  const quickPaymentTotal = validQuickPayments.reduce((sum, entry) => sum + entry.amount, 0)
  const subTotalBeforeCredits = grandTotal + previousBalanceAmount
  const payableAfterAdjustments = grandTotal + previousBalanceAmount - totalCredits - quickPaymentTotal
  const previewCreditEntries = [
    ...validCredits.map((c) => ({ id: c.id, date: c.date, amount: c.amount })),
    ...validQuickPayments.map((payment) => ({ id: payment.id, date: payment.date, amount: payment.amount })),
  ]
  const dedupedPreviewCreditEntries = dedupeBillPreviewCredits(previewCreditEntries)
  const marketPillTitle = [
    marketRate.rateDate ? `Rate date: ${formatFullDate(marketRate.rateDate)}` : '',
    marketRate.previousRate != null ? `Previous: ${formatInrInteger(marketRate.previousRate)}` : '',
    marketRate.change != null ? `Change: ${marketRate.change === 0 ? 'stable' : `${marketRate.change > 0 ? '+' : '-'}${formatInrInteger(Math.abs(marketRate.change))}`}` : '',
  ].filter(Boolean).join(' | ')

  const previewItemRows = validRows.map((r) => ({
    itemName: r.itemName,
    qty: r.qty,
    rate: r.rate,
    amount: r.qty * r.rate,
    bags: calculateBillingLineBags({ qty: r.qty, item: r }),
    type: getBillingItemType(r),
    unit: getBillingUnit(r),
  }))
  const draftPrintProps: BillPrintLayoutProps | null =
    customerId && validRows.length > 0
      ? {
          bookNo,
          billNo,
          date,
          customerName: selectedCustomerName,
          mkt: mktRate,
          itemRows: previewItemRows,
          gstAmount,
          transport,
          gstRate,
          currentBillTotal: grandTotal,
          previousBalance: previousBalanceAmount,
          previousBillDate: activePreviousBalanceDate,
          periodCreditEntries: dedupedPreviewCreditEntries,
          subtotal: subTotalBeforeCredits,
          finalTotal: payableAfterAdjustments,
          totalQty,
          totalBags: previewItemRows.reduce((s, r) => s + r.bags, 0),
          lrList,
        }
      : null

  function resetForm() {
    setDate(today)
    setCustomerId('')
    setMktRate(0)
    setTransport(0)
    setGstMode('none')
    setManualGstAmount(0)
    setRows([newBillItemRow()])
    setQuickPayments([])
    setLrInput('')
    setLrList([])
    manualBookRef.current = false
    manualBillNoRef.current = false
    void getNextBillNoForBook(bookNo)
      .then((next) => setBillNo(next ?? getBookRange(bookNo).firstBillNo))
      .catch(() => setBillNo((prev) => prev + 1))
    setIsQuickEntryOpen(false)
    setQuickCommandInput('')
    setPendingCommandPreview(false)
    setPreviewBalanceSnapshot(null)
    setBookSelectionWarning('')
  }

  function addLrChip() {
    const next = lrInput.trim()
    if (!next) return
    if (!lrList.includes(next)) setLrList((prev) => [...prev, next])
    setLrInput('')
  }

  function addQuickPaymentRow() {
    setQuickPayments((prev) => [...prev, newQuickPaymentRow(date)])
  }

  function updateQuickPaymentRow(id: string, patch: Partial<QuickPaymentRow>) {
    setQuickPayments((prev) => prev.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)))
  }

  function updateQuickPaymentAmount(id: string, amountInput: string) {
    updateQuickPaymentRow(id, {
      amountInput,
      amount: parseBillQuickPaymentAmountInput(amountInput),
    })
  }

  function normalizeQuickPaymentAmount(id: string) {
    setQuickPayments((prev) =>
      prev.map((payment) =>
        payment.id === id && payment.amount > 0
          ? { ...payment, amountInput: formatInrInteger(payment.amount).replace('₹', '') }
          : payment,
      ),
    )
  }

  function removeQuickPaymentRow(id: string) {
    setQuickPayments((prev) => prev.filter((payment) => payment.id !== id))
  }

  function addItemRow() {
    setRows((prev) => [...prev, newBillItemRow()])
  }

  function removeItemRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function updateRow(index: number, patch: Partial<BillItemRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const getLastRateForItem = useCallback((item: ItemOption) => {
    return findLastRateForItem(customerLastRatesQuery.data ?? {}, item)
  }, [customerLastRatesQuery.data])

  const getAutoRateFromDefault = useCallback((defaultRate: number, nextMktRate = mktRate, nextGstMode: GstMode = gstMode) => {
    return calculateGasFinalRate(defaultRate, nextMktRate, nextGstMode)
  }, [mktRate, gstMode])

  const getDefaultRateFromFinal = useCallback((finalRate: number, nextMktRate = mktRate, nextGstMode: GstMode = gstMode) => {
    return calculateGasDefaultRateFromFinal(finalRate, nextMktRate, nextGstMode)
  }, [mktRate, gstMode])

  const getAutoRate = useCallback((item: ItemOption, nextMktRate = mktRate, nextGstMode: GstMode = gstMode) => {
    return suggestBillingRate({
      item,
      mktRate: nextMktRate,
      gstMode: nextGstMode as BillingGstMode,
      lastRate: getLastRateForItem(item),
    })
  }, [getLastRateForItem, mktRate, gstMode])

  const getSuggestedRowPatch = useCallback((item: ItemOption, nextMktRate = mktRate, nextGstMode: GstMode = gstMode) => {
    const suggested = getAutoRate(item, nextMktRate, nextGstMode)
    return {
      itemId: item.id,
      itemName: item.name,
      defaultRate: suggested.defaultRate,
      rate: suggested.rate,
      manualRateEdited: false,
      type: item.type,
      unit: item.unit,
      bagWeight: item.bagWeight,
    }
  }, [getAutoRate, mktRate, gstMode])

  function updateGstMode(nextMode: GstMode) {
    setGstMode(nextMode)
    if (nextMode !== 'manual') setManualGstAmount(0)
    const items = itemsQuery.data ?? []
    if (items.length === 0) return
    setRows((prev) =>
      prev.map((row) => {
        if (!row.itemName || row.manualRateEdited) return row
        const selected = items.find((it) => it.name === row.itemName)
        if (!selected) return row
        return { ...row, ...getSuggestedRowPatch(selected, mktRate, nextMode) }
      }),
    )
  }

  function validateBeforePreview() {
    const parsed = submitBillSchema.safeParse({
      customerId,
      bookNo,
      billNo,
      date,
      items: validRows,
    })
    if (!parsed.success) {
      setStatusText(parsed.error.issues[0]?.message ?? 'Bill validation failed')
      return false
    }
    return true
  }

  async function openPreview() {
    if (!validateBeforePreview()) return
    try {
      setStatusText('Preparing preview...')
      await assertBillNumberAvailable(bookNo, billNo)
      // The preview prints previous balance and credit entries — refetch so it
      // can never show a stale snapshot (e.g. right after saving another bill).
      const refreshed = await autoBalanceQuery.refetch()
      setPreviewBalanceSnapshot(refreshed.data ?? null)
      setStatusText('')
      setIsPreviewOpen(true)
    } catch (error) {
      setStatusText(toUserMessage(error))
    }
  }

  async function applyBillCommand(input: string) {
    const firstPass = parseContextCommand(input, 'bill', {
      customers: customersQuery.data ?? [],
      items: itemsQuery.data ?? [],
      today,
      mktRate: 0,
    })
    const commandDate = firstPass.ok && firstPass.command.kind === 'bill' ? firstPass.command.date : date
    const savedRate = await loadSavedMarketRateForDate(commandDate)
    const commandMktRate = savedRate?.rate ?? 0
    const commandCustomerId = firstPass.ok && firstPass.command.kind === 'bill' ? firstPass.command.customer.id : ''
    const commandLastRates: Record<string, LastCustomerItemRate> = commandCustomerId
      ? await loadCustomerLastItemRates(commandCustomerId).catch(() => ({}))
      : {}
    const parserLastRates: Record<string, { rate: number; mktRate: number; gstRate: number }> = {}
    for (const [key, value] of Object.entries(commandLastRates)) {
      parserLastRates[`${commandCustomerId}:${key}`] = value
    }
    const parsed = parseContextCommand(input, 'bill', {
      customers: customersQuery.data ?? [],
      items: itemsQuery.data ?? [],
      today,
      mktRate: commandMktRate,
      lastRates: parserLastRates,
    })
    if (!parsed.ok) {
      setStatusText(parsed.error)
      return
    }
    if (parsed.command.kind !== 'bill') {
      setStatusText('This command is not a bill command.')
      return
    }
    const command = parsed.command
    const nextGstMode = command.gstMode === 'manual' ? 'manual' : command.gstRate === 18 ? 'percent18' : 'none'
    const itemMasters = itemsQuery.data ?? []
    const automaticBook = command.bookNo ? null : await getCustomerBookSelection(command.customer.id).catch(() => null)
    if (command.bookNo) {
      manualBookRef.current = true
      setBookSelectionWarning('')
      setBookNo(command.bookNo)
      if (command.billNo) {
        manualBillNoRef.current = true
        setBillNo(command.billNo)
      } else {
        manualBillNoRef.current = false
        const nextNo = await getNextBillNoForBook(command.bookNo).catch(() => null)
        setBillNo(nextNo ?? getBookRange(command.bookNo).firstBillNo)
      }
    } else if (automaticBook) {
      manualBookRef.current = false
      manualBillNoRef.current = Boolean(command.billNo)
      setBookNo(automaticBook.bookNo)
      setBillNo(command.billNo ?? automaticBook.billNo ?? 0)
      setBookSelectionWarning(automaticBook.warning)
    } else if (command.billNo) {
      manualBillNoRef.current = true
      setBillNo(command.billNo)
    }
    setCustomerId(command.customer.id)
    setDate(command.date)
    setMktRate(commandMktRate)
    setTransport(command.transport)
    setGstMode(nextGstMode)
    setManualGstAmount(command.gstMode === 'manual' ? command.gstAmount : 0)
    setRows(
      command.items.map((line) => {
        const selected =
          itemMasters.find((item) => item.id === line.item.id || item.name === line.item.name) ??
          {
            id: line.item.id,
            name: line.item.name,
            defaultRate: Number(line.item.defaultRate ?? 0),
            type: line.item.type ?? '',
            unit: line.item.unit ?? '',
            bagWeight: Number(line.item.bagWeight ?? 50) || 50,
          }
        const suggested = line.manualRateEdited
          ? null
          : suggestBillingRate({
              item: selected,
              mktRate: commandMktRate,
              gstMode: nextGstMode,
              lastRate: findLastRateForItem(commandLastRates, selected),
            })
        const fallbackDefaultRate = line.manualRateEdited && !isGasBillingItem(selected)
          ? line.rate
          : line.defaultRate || getDefaultRateFromFinal(line.rate, commandMktRate, nextGstMode)
        return {
          itemName: selected.name,
          itemId: selected.id,
          qty: line.qty,
          defaultRate: suggested?.defaultRate ?? fallbackDefaultRate,
          rate: suggested?.rate ?? line.rate,
          manualRateEdited: line.manualRateEdited,
          type: selected.type ?? '',
          unit: selected.unit ?? '',
          bagWeight: Number(selected.bagWeight ?? 50) || 50,
        }
      }),
    )
    setIsQuickEntryOpen(false)
    setStatusText(
      `Command ready: ${command.customer.name} | ${command.bookNo ? `Bill ${command.bookNo}/${command.billNo ?? 'next'} | ` : ''}${command.items.length} item${command.items.length === 1 ? '' : 's'} | ${command.date} | MKT ${commandMktRate || 'not found'}`,
    )
    setPendingCommandPreview(true)
  }

  async function applyQuickEntry() {
    await applyBillCommand(quickCommandInput)
  }

  async function confirmAndSave() {
    try {
      await saveMutation.mutateAsync()
      setIsPreviewOpen(false)
    } catch {
      // saveMutation handles error state text.
    }
  }

  useEffect(() => {
    if (customersQuery.isLoading || itemsQuery.isLoading) return
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_STORAGE_KEY)
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { kind?: string; body?: string; createdAt?: number }
      if (pending.kind !== 'bill' || !pending.body || Date.now() - Number(pending.createdAt ?? 0) > 60_000) return
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
      void applyBillCommand(pending.body)
    } catch {
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
    }
  }, [customersQuery.isLoading, itemsQuery.isLoading, customersQuery.data, itemsQuery.data])

  useEffect(() => {
    if (!pendingCommandPreview) return
    setPendingCommandPreview(false)
    void openPreview()
  }, [pendingCommandPreview, customerId, rows, date, bookNo, billNo])

  useEffect(() => {
    if (!isPreviewOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void confirmAndSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPreviewOpen, saveMutation.isPending, bookNo, billNo, customerId, date, rows, transport, gstRate, gstAmount])

  function printPreview() {
    const previewElement = previewRef.current
    if (!previewElement) return
    printBillLayoutFromElement(previewElement, BILL_PRINT_DOCUMENT_TITLE, setStatusText)
  }

  async function savePreviewAsJpg() {
    const previewElement = previewRef.current
    if (!previewElement) return
    try {
      await downloadBillLayoutAsJpg(previewElement, `bill-preview-${bookNo}-${billNo}.jpg`)
      setStatusText('')
    } catch {
      setStatusText('Unable to save JPG in this browser session. Please refresh once and retry.')
    }
  }

  async function shareOnWhatsApp() {
    const previewElement = previewRef.current
    if (!previewElement) return
    const billRef = `${String(bookNo).padStart(3, '0')}/${String(billNo).padStart(3, '0')}`
    const message = [
      `${COMPANY_NAME}`,
      `Bill Ref: ${billRef}`,
      `Party: ${selectedCustomerName}`,
      `Bill Date: ${formatFullDate(date)}`,
      `Current Bill: ${formatInrInteger(grandTotal)}`,
      `${previousBalanceAmount >= 0 ? 'Previous Balance' : 'Previous Advance'}: ${formatInrInteger(Math.abs(previousBalanceAmount))} (${previousBalanceDate === 'Opening' ? 'Opening' : formatFullDate(previousBalanceDate)})`,
      ...validCredits.map((entry) => `Credited on ${formatFullDate(entry.date)}: ${formatInrInteger(entry.amount)}`),
      ...validQuickPayments.map((entry) => `Quick payment on ${formatFullDate(entry.date)}: ${formatInrInteger(entry.amount)} (${entry.mode})`),
      `${payableAfterAdjustments >= 0 ? 'Amount Due' : 'Advance Balance'}: ${formatInrInteger(Math.abs(payableAfterAdjustments))}`,
    ].join('\n')

    await shareBillLayoutImageWithWhatsAppFallback({
      element: previewElement,
      imageFilename: `bill-preview-${bookNo}-${billNo}.jpg`,
      message,
      setStatus: setStatusText,
    })
  }

  useEffect(() => {
    if (marketRate.rate > 0) {
      setMktRate(marketRate.rate)
    }
  }, [marketRate.rate])

  useEffect(() => {
    const selection = customerBookQuery.data
    if (!selection || manualBookRef.current) return
    manualBillNoRef.current = false
    setBookNo(selection.bookNo)
    setBillNo(selection.billNo ?? 0)
    setBookSelectionWarning(selection.warning)
  }, [customerBookQuery.data])

  useEffect(() => {
    if (billNoInitializedRef.current) return
    if (nextBillNoQuery.isLoading) return
    setBillNo(resolvedNextBillNo)
    billNoInitializedRef.current = true
  }, [resolvedNextBillNo, nextBillNoQuery.isLoading])

  useEffect(() => {
    if (!billNoInitializedRef.current || manualBillNoRef.current || nextBillNoQuery.isLoading) return
    setBillNo(resolvedNextBillNo)
  }, [bookNo, resolvedNextBillNo, nextBillNoQuery.isLoading])

  useEffect(() => {
    const items = itemsQuery.data ?? []
    if (items.length === 0) return
    setRows((prev) =>
      prev.map((row) => {
        if (!row.itemName || row.manualRateEdited) return row
        const selected = items.find((it) => it.id === row.itemId || it.name === row.itemName)
        if (!selected) return row
        return { ...row, ...getSuggestedRowPatch(selected) }
      }),
    )
  }, [mktRate, itemsQuery.data, gstMode, getSuggestedRowPatch])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setIsQuickEntryOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Bill Details</h3>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              title={marketPillTitle || 'Market rate'}
              className="inline-flex h-9 items-center rounded-full border border-blue-200 bg-blue-50 px-3 font-mono text-sm font-bold tabular-nums text-blue-800 transition hover:border-blue-300 hover:bg-blue-100"
              onClick={() => setMarketPillOpen((prev) => !prev)}
              onBlur={() => window.setTimeout(() => setMarketPillOpen(false), 120)}
            >
              MKT {Math.round(mktRate || marketRate.rate || 0)}
            </button>
            {marketPillOpen && (
              <div className="absolute right-0 top-11 z-30 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg">
                <p className="font-semibold text-slate-900">Jamnagar Local Rate</p>
                <p className="mt-1">Date: {marketRate.rateDate ? formatFullDate(marketRate.rateDate) : '-'}</p>
                <p>Previous: {marketRate.previousRate != null ? formatInrInteger(marketRate.previousRate) : '-'}</p>
                <p>
                  Change:{' '}
                  {marketRate.change == null
                    ? '-'
                    : marketRate.change === 0
                      ? 'Stable'
                      : `${marketRate.change > 0 ? '+' : '-'}${formatInrInteger(Math.abs(marketRate.change))}`}
                </p>
              </div>
            )}
            <button
              type="button"
              aria-label="Refresh market rate"
              className="inline-grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
              onClick={() => {
                void refreshMarketRate({ targetDate: date }).then((ok) => {
                  if (ok) {
                    setStatusText('Market rate updated from RSS')
                  } else {
                    setStatusText('Could not fetch RSS rate')
                  }
                })
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Book No" hint={bookSelectionWarning || undefined} hintTone={bookSelectionWarning ? 'warning' : 'muted'}>
            <input
              className={inputClass}
              type="number"
              value={bookNo}
              onChange={(e) => {
                manualBookRef.current = true
                manualBillNoRef.current = false
                setBookSelectionWarning('')
                setBookNo(parseNonNegativeNumber(e.target.value))
              }}
            />
          </Field>
          <Field
            label="Bill No"
            hint={billNoHint.text}
            hintTone={billNoHint.tone}
          >
            <input
              className={inputClass}
              type="number"
              value={billNo}
              onChange={(e) => {
                manualBillNoRef.current = true
                setBillNo(parseNonNegativeNumber(e.target.value))
              }}
            />
          </Field>
          <Field label="Date">
            <DateInput className={inputClass} value={date} onChange={setDate} />
          </Field>
          <Field label="Customer">
            <SearchableCombobox
              options={customersQuery.data ?? []}
              value={customerId}
              onChange={(nextId) => {
                manualBookRef.current = false
                manualBillNoRef.current = false
                setCustomerId(nextId)
                setRows([newBillItemRow()])
                setStatusText('')
              }}
              inputClassName={inputClass}
              placeholder={customersQuery.isLoading ? 'Loading customers...' : 'Search customer...'}
              disabled={customersQuery.isLoading || customersQuery.isError}
              emptyText="No matching customer found."
              maxResults={25}
            />
          </Field>
          <Field label="MKT Rate">
            <input className={inputClass} type="number" value={mktRate} onChange={(e) => setMktRate(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Transport (INR) (optional)">
            <input className={inputClass} type="number" value={transport} onChange={(e) => setTransport(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="GST (optional)">
            <select className={inputClass} value={gstMode} onChange={(e) => updateGstMode(e.target.value as GstMode)}>
              <option value="none">No GST</option>
              <option value="percent18">18% GST (-₹30 rate)</option>
              <option value="manual">Manual GST amount</option>
            </select>
          </Field>
          {gstMode === 'manual' && (
            <Field label="GST Amount (INR)">
              <input
                className={inputClass}
                type="number"
                value={manualGstAmount || ''}
                onChange={(e) => setManualGstAmount(parseNonNegativeNumber(e.target.value))}
                placeholder="0"
              />
            </Field>
          )}
          <Field label="Previous Balance Date (auto)">
            <input className={`${inputClass} bg-slate-50`} type="text" value={previousBalanceDate === 'Opening' ? 'Opening' : formatFullDate(previousBalanceDate)} readOnly />
          </Field>
          <Field label="Previous Balance Amount (auto)">
            <input className={`${inputClass} bg-slate-50`} type="text" value={formatInrInteger(previousBalanceAmount)} readOnly />
          </Field>
          <Field label="LR Numbers (optional)">
            <div className="flex min-w-0 items-center gap-2">
              <input
                className={inputClass}
                type="text"
                value={lrInput}
                onChange={(e) => setLrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addLrChip()
                  }
                }}
                placeholder="Enter LR No"
              />
              <button
                type="button"
                className="h-10 shrink-0 rounded-md border border-slate-300 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={addLrChip}
              >
                Add
              </button>
            </div>
          </Field>
        </div>
        {lrList.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {lrList.map((lr) => (
              <span
                key={lr}
                title={lr}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 pl-2.5 pr-1.5 py-1 text-xs text-slate-800"
              >
                <span className="min-w-0 max-w-[12rem] truncate font-medium">{lr}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove ${lr}`}
                  onClick={() => setLrList((prev) => prev.filter((v) => v !== lr))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Previous Balance & Credits</p>
            {autoBalanceQuery.isFetching ? (
              <span className="text-xs text-slate-500">Calculating…</span>
            ) : (
              totalCredits > 0 && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {validCredits.length} payment{validCredits.length === 1 ? '' : 's'} · -{formatInrInteger(totalCredits)}
                </span>
              )
            )}
          </div>
          <div className="space-y-1.5 text-sm text-slate-700">
            {!customerId && <p className="text-slate-400">Picked automatically once you choose a party.</p>}
            {customerId && autoBalanceQuery.isSuccess && (
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                <span className="text-slate-600">
                  Balance till {previousBalanceDate === 'Opening' ? 'opening' : formatFullDate(previousBalanceDate)}
                </span>
                <span className={`font-mono font-semibold tabular-nums ${previousBalanceAmount > 0 ? 'text-slate-900' : previousBalanceAmount < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {formatInrInteger(previousBalanceAmount)}
                </span>
              </div>
            )}
            {validCredits.map((entry, index) => (
              <div key={`${entry.date}-${entry.amount}-${index}`} className="flex items-center justify-between rounded-md border border-emerald-100 bg-white px-2.5 py-1.5">
                <span className="text-slate-600">Received {formatFullDate(entry.date)}</span>
                <span className="font-mono font-semibold tabular-nums text-emerald-600">- {formatInrInteger(entry.amount)}</span>
              </div>
            ))}
            {customerId && !autoBalanceQuery.isFetching && validCredits.length === 0 && (
              <p className="text-xs text-slate-400">No payments received since the last bill.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Quick Payment <span className="ml-1 text-xs font-normal text-slate-400">optional</span></h3>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            onClick={addQuickPaymentRow}
          >
            <Plus size={14} /> Add Payment
          </button>
        </div>
        {quickPayments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            No quick payments added. Add one if the party pays while making this bill.
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[820px] table-fixed border-separate border-spacing-x-2 border-spacing-y-0">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[15%]" />
                <col className="w-[39%]" />
                <col className="w-[72px]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Mode</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Note</th>
                  <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {quickPayments.map((payment, index) => (
                  <tr key={payment.id} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 align-middle">
                      <DateInput className={inputClass} value={payment.date} onChange={(nextDate) => updateQuickPaymentRow(payment.id, { date: nextDate })} />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="text"
                        inputMode="decimal"
                        value={payment.amountInput}
                        onChange={(event) => updateQuickPaymentAmount(payment.id, event.target.value)}
                        onBlur={() => normalizeQuickPaymentAmount(payment.id)}
                        placeholder="190, 1.9l, 50k"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <select
                        className={inputClass}
                        value={payment.mode}
                        onChange={(event) => updateQuickPaymentRow(payment.id, { mode: event.target.value as 'Cash' | 'Bank' })}
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank">Bank</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        className={inputClass}
                        value={payment.note}
                        onChange={(event) => updateQuickPaymentRow(payment.id, { note: event.target.value })}
                        placeholder={`Quick payment ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle text-center">
                      <button
                        type="button"
                        className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeQuickPaymentRow(payment.id)}
                        aria-label={`Remove quick payment ${index + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {quickPaymentTotal > 0 && (
          <div className="mt-4 flex justify-end">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">Quick payment total</p>
              <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-900">{formatInrInteger(quickPaymentTotal)}</p>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Items{validRows.length > 0 && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{validRows.length}</span>}
          </h3>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700" onClick={addItemRow}>
            <Plus size={14} /> Add Row
          </button>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-x-2 border-spacing-y-0">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[22%]" />
              <col className="w-[72px]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Qty</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Margin / Unit</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Final Rate</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                <th className="px-3 py-2.5"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const amount = row.qty * row.rate
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 align-middle">
                      <select
                        className={inputClass}
                        value={row.itemId || ((itemsQuery.data ?? []).find((it) => it.name === row.itemName)?.id ?? '')}
                        disabled={itemsQuery.isLoading || itemsQuery.isError}
                        onChange={(e) => {
                          const id = e.target.value
                          const selected = (itemsQuery.data ?? []).find((it) => it.id === id)
                          if (!selected) {
                            updateRow(i, newBillItemRow())
                            return
                          }
                          updateRow(i, getSuggestedRowPatch(selected))
                        }}
                      >
                        <option value="">{itemsQuery.isLoading ? 'Loading items…' : 'Select item…'}</option>
                        {availableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {getBillingItemType(item) === 'electronic' ? 'pcs' : 'kg'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        value={row.qty === 0 ? '' : String(row.qty)}
                        onChange={(e) => updateRow(i, { qty: parsePositiveIntInput(e.target.value) })}
                        onBlur={() => {
                          if (row.qty === 0) updateRow(i, { qty: 0 })
                        }}
                        placeholder={getBillingUnit(row) === 'piece' ? 'pcs' : 'kg'}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        min={0}
                        step="any"
                        value={row.defaultRate || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') {
                            updateRow(i, { defaultRate: 0, rate: 0, manualRateEdited: false })
                            return
                          }
                          const n = Number(v)
                          const defaultRate = Number.isFinite(n) ? n : 0
                          const nextRate = isGasBillingItem(row)
                            ? getAutoRateFromDefault(defaultRate)
                            : defaultRate
                          updateRow(i, {
                            defaultRate,
                            rate: nextRate,
                            manualRateEdited: false,
                          })
                        }}
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        min={0}
                        step="any"
                        value={row.rate || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') {
                            updateRow(i, { rate: 0, defaultRate: 0, manualRateEdited: true })
                            return
                          }
                          const n = Number(v)
                          const rate = Number.isFinite(n) ? n : 0
                          updateRow(i, {
                            rate,
                            defaultRate: isGasBillingItem(row) ? getDefaultRateFromFinal(rate) : rate,
                            manualRateEdited: true,
                          })
                        }}
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                      {formatInrInteger(amount)}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-center">
                      <button
                        type="button"
                        className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeItemRow(i)}
                        aria-label={`Remove item row ${i + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
            <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Qty" value={qtySummary} />
              <Metric label="Items" value={formatInrInteger(itemsTotal)} />
              <Metric label="Transport" value={formatInrInteger(transport)} />
              <Metric label="GST" value={formatInrInteger(gstAmount)} />
            </div>
            <div className="grid min-w-0 flex-[1.35] grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-5">
              <CalcMetric label="Current" value={formatInrInteger(grandTotal)} />
              <CalcMetric
                label={previousBalanceAmount >= 0 ? 'Prev Bal' : 'Prev Adv'}
                value={`${previousBalanceAmount >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(previousBalanceAmount))}`}
              />
              <CalcMetric label={`Credits (${validCredits.length})`} value={`-${formatInrInteger(totalCredits)}`} />
              <CalcMetric label={`Quick Pay (${validQuickPayments.length})`} value={`-${formatInrInteger(quickPaymentTotal)}`} />
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 md:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-600">
                  {payableAfterAdjustments >= 0 ? 'Amount Due' : 'Advance'}
                </p>
                <p className="mt-0.5 truncate font-mono text-base font-bold tabular-nums" title={formatInrInteger(Math.abs(payableAfterAdjustments))}>
                  {formatInrInteger(Math.abs(payableAfterAdjustments))}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-[calc(3.85rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur lg:static lg:mx-0 lg:border-t-0 lg:bg-transparent lg:p-0">
          <span className="flex items-baseline gap-2 text-xs text-slate-500">
            {statusText ? (
              <span>{helperStatusText}</span>
            ) : (
              <>
                <span>{payableAfterAdjustments >= 0 ? 'Amount due' : 'Advance'}</span>
                <span className="font-mono text-sm font-bold tabular-nums text-slate-900">{formatInrInteger(Math.abs(payableAfterAdjustments))}</span>
              </>
            )}
          </span>
          <div className="flex-1" />
          <button type="button" className="px-1 py-1 text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline" onClick={resetForm}>
            Clear
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:px-3"
            onClick={() => void openPreview()}
            disabled={saveMutation.isPending || customersQuery.isLoading || itemsQuery.isLoading}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Bill'}
          </button>
        </div>
      </section>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-3 py-4 sm:px-4 sm:py-8">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-4rem)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-900">Bill Preview & Confirmation</h3>
                <p className="mt-0.5 text-xs text-slate-500">Review the exact print layout before saving.</p>
              </div>
              <button type="button" className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsPreviewOpen(false)}>
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-50 px-3 py-4 sm:px-4">
              <div className="mx-auto flex w-full max-w-[14cm] justify-center">
                <div
                  ref={previewRef}
                  className={`${BILL_PREVIEW_CARD_CLASS} w-full`}
                  style={{ width: `${BILL_PRINT_PAGE_WIDTH_CM}cm`, maxWidth: '100%' }}
                >
                {draftPrintProps ? (
                  <BillPrintLayout {...draftPrintProps} />
                ) : (
                  <p className="p-4 text-sm text-slate-500">Unable to build preview.</p>
                )}
                </div>
              </div>
            </div>
            <div className="grid shrink-0 gap-3 border-t border-slate-200 bg-white px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
              <span className="text-xs text-slate-500">Ctrl+Enter confirms save</span>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={printPreview}>
                Print
              </button>
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => void savePreviewAsJpg()}>
                Save JPG
              </button>
              <button type="button" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100" onClick={shareOnWhatsApp}>
                Share WhatsApp
              </button>
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsPreviewOpen(false)}>
                Back to Edit
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void confirmAndSave()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isQuickEntryOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Bill Command (Alt + B)</h3>
              <button type="button" className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsQuickEntryOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-2 px-4 py-4">
              <input
                autoFocus
                className={inputClass}
                value={quickCommandInput}
                onChange={(e) => setQuickCommandInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void applyQuickEntry()
                  }
                }}
                placeholder='party [item] qty [rate=auto] [gst] [date=today|-1|DD-MM-YYYY] [+t 2000] (default item: Spindle (8.5.Gm))'
              />
              <p className="text-xs text-slate-500">Gas qty rule: 10 means 10 bags / 500 kg. Use kg suffix for exact kg. Default item is Spindle (8.5GM).</p>
              <p className="text-xs text-slate-500">Examples: `sambhu 10` | `sambhu spindle 10 gst +t 2000` | `sambhu tapper 620kg 790 -1`</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsQuickEntryOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={() => void applyQuickEntry()}>
                Preview Command
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children, hint, hintTone = 'muted' }: { label: string; children: ReactNode; hint?: string; hintTone?: 'muted' | 'warning' }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className={`text-[11px] ${hintTone === 'warning' ? 'text-amber-600' : 'text-slate-500'}`}>{hint}</span> : null}
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-slate-900" title={value}>{value}</p>
    </div>
  )
}

function CalcMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-2">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-slate-900" title={value}>{value}</p>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
