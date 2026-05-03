import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { saveBillWithItems } from '@/data/bills'
import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase, calculateBillTotals } from '@/domain/billing-calculations'
import { computeNetBalance, isOnOrBeforeDay } from '@/domain/financial-math'
import { useMarketRate } from '@/domain/market-rate'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import {
  BILL_PREVIEW_CARD_CLASS,
  BILL_PRINT_DOCUMENT_TITLE,
  downloadBillLayoutAsJpg,
  printBillLayoutFromElement,
  shareBillLayoutImageWithWhatsAppFallback,
} from '@/lib/bill-print-export'
import { formatInQty, formatInrInteger, parseNonNegativeNumber, parsePositiveIntInput } from '@/lib/inr-format'
import { findBestNameMatch } from '@/lib/search'

export const Route = createFileRoute('/new-bill')({
  component: NewBillPage,
})

type CustomerOption = { id: string; name: string }
type ItemOption = { id: string; name: string; defaultRate: number }
type BillItemRow = { itemName: string; qty: number; rate: number; manualRateEdited: boolean }
type CreditAdjustment = { date: string; amount: number }
type AutoBalanceContext = { previousBalanceDate: string; previousBalanceAmount: number; credits: CreditAdjustment[] }
type PBRecord = Record<string, unknown> & { id: string }
const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)
const toTs = (v: unknown) => {
  const ts = new Date(String(v ?? '')).getTime()
  return Number.isFinite(ts) ? ts : 0
}
const bagsFromQtyKg = (qtyKg: number) => {
  if (!(qtyKg > 0)) return 0
  return Math.round(qtyKg / 50)
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

function NewBillPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [bookNo, setBookNo] = useState<number>(51)
  const [billNo, setBillNo] = useState<number>(1)
  const [date, setDate] = useState(today)
  const [customerId, setCustomerId] = useState('')
  const [mktRate, setMktRate] = useState<number>(0)
  const [transport, setTransport] = useState<number>(0)
  const [gstRate, setGstRate] = useState<number>(0)
  const [lrInput, setLrInput] = useState('')
  const [lrList, setLrList] = useState<string[]>([])
  const [rows, setRows] = useState<BillItemRow[]>([{ itemName: '', qty: 0, rate: 0, manualRateEdited: false }])
  const [statusText, setStatusText] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false)
  const [quickCommandInput, setQuickCommandInput] = useState('')
  const { marketRate, refreshMarketRate } = useMarketRate(date)
  const billNoInitializedRef = useRef(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const customersQuery = useQuery({
    queryKey: ['customers-options'],
    queryFn: async (): Promise<CustomerOption[]> => {
      const records = await pb.collection('customers').getFullList({ sort: 'name' })
      return records.map((r) => ({ id: r.id, name: String(r.name ?? '') }))
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
      }))
    },
  })

  const latestBillNoQuery = useQuery({
    queryKey: ['latest-bill-no'],
    queryFn: async (): Promise<number> => {
      const page = await pb.collection('bills').getList(1, 1, { sort: '-bill_no' })
      const record = page.items[0]
      return Number(record?.bill_no ?? 0)
    },
  })
  const autoBalanceQuery = useQuery({
    queryKey: ['customer-auto-balance', customerId, date],
    enabled: Boolean(customerId && date),
    queryFn: async (): Promise<AutoBalanceContext> => {
      const [billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
        pb.collection('bills').getFullList({
          sort: 'date,bill_no',
          filter: `customer = "${customerId}"`,
        }),
        pb.collection('bill_items').getFullList(),
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
        total: calculateBillTotalFromBase(itemTotalByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate)),
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
            (entry.date === lastBillDate &&
              ((entry.createdTs > 0 && lastBillCreatedTs > 0 && entry.createdTs > lastBillCreatedTs) ||
                (entry.createdTs === 0 || lastBillCreatedTs === 0)))) &&
          isOnOrBeforeDay(entry.date, date),
      )

      return {
        previousBalanceDate: lastBillDate || date,
        previousBalanceAmount,
        credits,
      }
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const customer = (customersQuery.data ?? []).find((c) => c.id === customerId)
      if (!customer) throw new Error('Please select a customer')
      const validRows = rows.filter((r) => r.itemName.trim() && r.qty > 0 && r.rate > 0)
      const parsed = submitBillSchema.safeParse({
        customerId,
        bookNo,
        billNo,
        date,
        items: validRows,
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Bill validation failed')
      }

      await saveBillWithItems({
        bookNo,
        billNo,
        date,
        customerId: customer.id,
        customerName: customer.name,
        mktRate,
        transport,
        gstRate,
        lrList,
        items: validRows,
      })
    },
    onSuccess: () => {
      setStatusText('Bill saved successfully')
      resetForm()
    },
    onError: (err) => {
      setStatusText(toUserMessage(err))
    },
  })

  const totals = useMemo(() => {
    return calculateBillTotals({
      items: rows,
      transport,
      gstRate,
    })
  }, [rows, gstRate, transport])

  const helperStatusText = useMemo(() => {
    if (statusText) return statusText
    const hasCustomer = Boolean(customerId)
    const hasValidRow = rows.some((r) => r.itemName && r.qty > 0 && r.rate > 0)
    return hasCustomer && hasValidRow ? 'Ready to save' : 'Fill required fields to save'
  }, [statusText, customerId, rows])
  const selectedCustomerName = (customersQuery.data ?? []).find((c) => c.id === customerId)?.name ?? 'Unknown'
  const validRows = rows.filter((r) => r.itemName.trim() && r.qty > 0 && r.rate > 0)
  const previousBalanceDate = autoBalanceQuery.data?.previousBalanceDate ?? date
  const previousBalanceAmount = autoBalanceQuery.data?.previousBalanceAmount ?? 0
  const validCredits = (autoBalanceQuery.data?.credits ?? []).filter((entry) => entry.amount > 0)
  const totalCredits = validCredits.reduce((sum, entry) => sum + entry.amount, 0)
  const subTotalBeforeCredits = totals.grandTotal + previousBalanceAmount
  const payableAfterAdjustments = totals.grandTotal + previousBalanceAmount - totalCredits

  const draftPrintProps = useMemo((): BillPrintLayoutProps | null => {
    if (!customerId || validRows.length === 0) return null
    const itemRows = validRows.map((r) => ({
      itemName: r.itemName,
      qty: r.qty,
      rate: r.rate,
      amount: r.qty * r.rate,
      bags: bagsFromQtyKg(r.qty),
    }))
    return {
      bookNo,
      billNo,
      date,
      customerName: selectedCustomerName,
      mkt: mktRate,
      itemRows,
      gstAmount: totals.gstAmount,
      transport,
      gstRate,
      currentBillTotal: totals.grandTotal,
      previousBalance: previousBalanceAmount,
      previousBillDate: previousBalanceDate,
      periodCreditEntries: validCredits.map((c) => ({ date: c.date, amount: c.amount })),
      subtotal: subTotalBeforeCredits,
      finalTotal: payableAfterAdjustments,
      totalQty: totals.totalQty,
      totalBags: itemRows.reduce((s, r) => s + r.bags, 0),
      lrList,
    }
  }, [
    customerId,
    validRows,
    bookNo,
    billNo,
    date,
    selectedCustomerName,
    mktRate,
    totals.gstAmount,
    totals.grandTotal,
    totals.totalQty,
    transport,
    gstRate,
    previousBalanceAmount,
    previousBalanceDate,
    validCredits,
    subTotalBeforeCredits,
    payableAfterAdjustments,
    lrList,
  ])

  function resetForm() {
    setDate(today)
    setCustomerId('')
    setMktRate(0)
    setTransport(0)
    setGstRate(0)
    setRows([{ itemName: '', qty: 0, rate: 0, manualRateEdited: false }])
    setLrInput('')
    setLrList([])
    setBillNo((prev) => prev + 1)
    setIsQuickEntryOpen(false)
    setQuickCommandInput('')
  }

  function addLrChip() {
    const next = lrInput.trim()
    if (!next) return
    if (!lrList.includes(next)) setLrList((prev) => [...prev, next])
    setLrInput('')
  }


  function addItemRow() {
    setRows((prev) => [...prev, { itemName: '', qty: 0, rate: 0, manualRateEdited: false }])
  }

  function removeItemRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function updateRow(index: number, patch: Partial<BillItemRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
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

  function openPreview() {
    if (!validateBeforePreview()) return
    setStatusText('')
    setIsPreviewOpen(true)
  }

  function applyQuickEntry() {
    const parsed = parseQuickCommandLine(quickCommandInput, customersQuery.data ?? [], itemsQuery.data ?? [], today, mktRate)
    if (!parsed.ok) {
      setStatusText(parsed.error)
      return
    }
    setCustomerId(parsed.customer.id)
    setDate(parsed.date)
    setTransport(parsed.transport)
    setGstRate(parsed.gstRate)
    setRows([
      {
        itemName: parsed.item.name,
        qty: parsed.qtyKg,
        rate: parsed.rate,
        manualRateEdited: true,
      },
    ])
    setStatusText(`Quick Entry applied (${parsed.qtyHint})`)
    setIsQuickEntryOpen(false)
  }

  async function confirmAndSave() {
    try {
      await saveMutation.mutateAsync()
      setIsPreviewOpen(false)
    } catch {
      // saveMutation handles error state text.
    }
  }

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
      `Current Bill: ${formatInrInteger(totals.grandTotal)}`,
      `${previousBalanceAmount >= 0 ? 'Previous Balance' : 'Previous Advance'}: ${formatInrInteger(Math.abs(previousBalanceAmount))} (${previousBalanceDate === 'Opening' ? 'Opening' : formatFullDate(previousBalanceDate)})`,
      ...validCredits.map((entry) => `Credited on ${formatFullDate(entry.date)}: ${formatInrInteger(entry.amount)}`),
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
    if (billNoInitializedRef.current) return
    if (latestBillNoQuery.isLoading) return
    const latest = Number(latestBillNoQuery.data ?? 0)
    setBillNo(latest > 0 ? latest + 1 : 1)
    billNoInitializedRef.current = true
  }, [latestBillNoQuery.data, latestBillNoQuery.isLoading])

  useEffect(() => {
    const items = itemsQuery.data ?? []
    if (items.length === 0) return
    setRows((prev) =>
      prev.map((row) => {
        if (!row.itemName || row.manualRateEdited) return row
        const selected = items.find((it) => it.name === row.itemName)
        if (!selected) return row
        return { ...row, rate: selected.defaultRate + mktRate }
      }),
    )
  }, [mktRate, itemsQuery.data])

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Jamnagar Local Rate</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">{formatInrInteger(marketRate.rate)}</p>
            <p className="text-xs text-slate-500">{marketRate.rateDate}</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
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
            Refresh Rate
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Bill Details</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Book No">
            <input className={inputClass} type="number" value={bookNo} onChange={(e) => setBookNo(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Bill No">
            <input className={inputClass} type="number" value={billNo} onChange={(e) => setBillNo(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Customer">
            <SearchableCombobox
              options={customersQuery.data ?? []}
              value={customerId}
              onChange={(nextId) => {
                setCustomerId(nextId)
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
            <select className={inputClass} value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
              <option value={0}>No GST</option>
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={18}>18%</option>
            </select>
          </Field>
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Credit Entries (auto)</p>
            {autoBalanceQuery.isFetching && <span className="text-xs text-slate-500">Loading...</span>}
          </div>
          <div className="space-y-1 text-sm text-slate-700">
            {!customerId && <p>Select customer to load credit history.</p>}
            {customerId && autoBalanceQuery.isSuccess && (
              <p>
                Previous balance as on <span className="font-semibold">{previousBalanceDate === 'Opening' ? 'Opening' : formatFullDate(previousBalanceDate)}</span>:{' '}
                <span className="font-mono font-semibold">{formatInrInteger(previousBalanceAmount)}</span>
              </p>
            )}
            {customerId && !autoBalanceQuery.isFetching && validCredits.length === 0 && <p>No credits found after last bill date.</p>}
            {validCredits.map((entry, index) => (
              <div key={`${entry.date}-${entry.amount}-${index}`} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5">
                <span className="font-medium">{formatFullDate(entry.date)}</span>
                <span className="font-mono text-slate-900">- {formatInrInteger(entry.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Items</h3>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700" onClick={addItemRow}>
            <Plus size={14} /> Add Row
          </button>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-x-2 border-spacing-y-0">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[24%]" />
              <col className="w-[72px]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Qty</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Rate</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Action</th>
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
                        value={(itemsQuery.data ?? []).find((it) => it.name === row.itemName)?.id ?? ''}
                        disabled={itemsQuery.isLoading || itemsQuery.isError}
                        onChange={(e) => {
                          const id = e.target.value
                          const selected = (itemsQuery.data ?? []).find((it) => it.id === id)
                          if (!selected) {
                            updateRow(i, { itemName: '', rate: 0, manualRateEdited: false })
                            return
                          }
                          updateRow(i, {
                            itemName: selected.name,
                            rate: selected.defaultRate + mktRate,
                            manualRateEdited: false,
                          })
                        }}
                      >
                        <option value="">{itemsQuery.isLoading ? 'Loading items…' : 'Select item…'}</option>
                        {(itemsQuery.data ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
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
                            updateRow(i, { rate: 0, manualRateEdited: true })
                            return
                          }
                          const n = Number(v)
                          updateRow(i, { rate: Number.isFinite(n) ? n : 0, manualRateEdited: true })
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

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap sm:items-end sm:gap-8">
              <Metric label="Total Qty" value={formatInQty(totals.totalQty, 'kg')} />
              <Metric label="Line items" value={formatInrInteger(totals.itemsTotal)} />
              <Metric label="Transport" value={formatInrInteger(transport)} />
              <Metric label="GST" value={formatInrInteger(totals.gstAmount)} />
              {previousBalanceAmount !== 0 && (
                <Metric label={previousBalanceAmount >= 0 ? 'Previous Balance' : 'Previous Advance'} value={formatInrInteger(Math.abs(previousBalanceAmount))} />
              )}
              <Metric label="Sub Total" value={formatInrInteger(subTotalBeforeCredits)} />
              <Metric label="Credited Entries" value={String(validCredits.length)} />
            </div>
            <div className="text-left lg:text-right">
              <p className="text-xs text-slate-400">{payableAfterAdjustments >= 0 ? 'Amount Due' : 'Advance Balance'}</p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-slate-900">{formatInrInteger(Math.abs(payableAfterAdjustments))}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{helperStatusText}</span>
          <div className="flex-1" />
          <button type="button" className="px-1 py-1 text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline" onClick={resetForm}>
            Clear
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openPreview}
            disabled={saveMutation.isPending || customersQuery.isLoading || itemsQuery.isLoading}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Bill'}
          </button>
        </div>
      </section>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Bill Preview & Confirmation</h3>
              <button type="button" className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsPreviewOpen(false)}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <div className="flex justify-center">
                <div
                  ref={previewRef}
                  className={BILL_PREVIEW_CARD_CLASS}
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
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
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
                    applyQuickEntry()
                  }
                }}
                placeholder='party [item] qty [rate=auto] [gst] [date=today|-1|DD-MM-YYYY] [+t 2000] (default item: Spindle (8.5.Gm))'
              />
              <p className="text-xs text-slate-500">Qty rule: if qty is 50 or less it is treated as bags, else treated as kg.</p>
              <p className="text-xs text-slate-500">Examples: `sambhu 10` | `sambhu spindle 10 gst +t 2000` | `sambhu tapper 620 790 -1`</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsQuickEntryOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={applyQuickEntry}>
                Apply to Bill Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[112px]">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-mono text-sm font-medium tabular-nums text-slate-800">{value}</p>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

function parseQuickCommandLine(
  input: string,
  customers: Array<{ id: string; name: string }>,
  items: Array<{ id: string; name: string; defaultRate: number }>,
  today: string,
  mktRate: number,
):
  | {
      ok: true
      customer: { id: string; name: string }
      item: { id: string; name: string; defaultRate: number }
      qtyKg: number
      qtyHint: string
      rate: number
      gstRate: number
      date: string
      transport: number
    }
  | { ok: false; error: string } {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Quick command is empty' }
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return { ok: false, error: 'Use: party [item] qty [rate] [gst] [date] [+t amount]' }

  const customer = resolveByName(tokens[0], customers)
  if (!customer) return { ok: false, error: `Party not found: ${tokens[0]}` }

  let qtyIndex = -1
  for (let i = 1; i < tokens.length; i += 1) {
    if (Number.isFinite(Number(tokens[i])) && Number(tokens[i]) > 0) {
      qtyIndex = i
      break
    }
  }
  if (qtyIndex < 0) return { ok: false, error: 'Quantity missing in command' }
  const qtyRaw = Number(tokens[qtyIndex])
  const qtyKg = qtyRaw <= 50 ? qtyRaw * 50 : qtyRaw
  const qtyHint = qtyRaw <= 50 ? `${Math.round(qtyRaw)} bags` : `${Math.round(qtyRaw)} kg`

  const itemToken = tokens.slice(1, qtyIndex).join(' ').trim()
  const defaultItemName = 'Spindle (8.5.Gm)'
  const fallbackItem = items.find((item) => item.name.toLowerCase() === defaultItemName.toLowerCase()) ?? items[0]
  const item = itemToken ? resolveByName(itemToken, items) : fallbackItem
  if (!item) return { ok: false, error: 'Item list is empty' }

  let rate = item.defaultRate + mktRate
  let gstRate = 0
  let date = today
  let transport = 0
  for (let i = qtyIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i].toLowerCase()
    if (Number.isFinite(Number(token)) && Number(token) > 0) {
      rate = Number(token)
      continue
    }
    if (token === 'gst' || token === 'm') {
      gstRate = 18
      continue
    }
    if ((token === '+t' || token === '+transport') && i + 1 < tokens.length) {
      transport = Number(tokens[i + 1]) || transport
      i += 1
      continue
    }
    date = parseQuickDateToken(token, today)
  }

  return { ok: true, customer, item, qtyKg, qtyHint, rate, gstRate, date, transport }
}

function resolveByName<T extends { name: string }>(token: string, records: T[]) {
  return findBestNameMatch(records, token, (record) => record.name) ?? null
}

function parseQuickDateToken(value: string, today: string) {
  const token = value.trim().toLowerCase()
  if (!token) return today
  if (token === 'today' || token === '0') return today
  if (token === '-1' || token === 'yday' || token === 'yesterday') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return getLocalIsoDate(d)
  }
  const m = token.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return token
}
