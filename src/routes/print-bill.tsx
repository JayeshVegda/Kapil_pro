import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, Edit3, Printer, Search, Share2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM } from '@/components/billing/bill-print-layout'
import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { formatFullDate } from '@/lib/date'
import { formatCompanyName, formatCustomerDisplayName } from '@/lib/customer-display'
import {
  BILL_PREVIEW_CARD_CLASS,
  BILL_PRINT_DOCUMENT_TITLE,
  downloadBillLayoutAsJpg,
  printBillLayoutFromElement,
  shareBillLayoutImageWithWhatsAppFallback,
} from '@/lib/bill-print-export'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/print-bill')({
  validateSearch: (search: Record<string, unknown>) => ({
    billId: typeof search.billId === 'string' ? search.billId : '',
    billRef: typeof search.billRef === 'string' ? search.billRef : '',
  }),
  component: PrintBillPage,
})

type PBRecord = Record<string, unknown> & { id: string }

type BillOption = {
  id: string
  billRef: string
  billNo: number
  bookNo: number
  date: string
  customerId: string
  customerName: string
  printCustomerName: string
  mkt: number
  transport: number
  gstRate: number
  gstAmount: number
  lrNo: string
  total: number
  itemSummary: string
}

type BillPrintItem = {
  itemName: string
  qty: number
  rate: number
  amount: number
  bags: number
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

function PrintBillPage() {
  const routeSearch = Route.useSearch()
  const [search, setSearch] = useState('')
  const [selectedBillId, setSelectedBillId] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  const printQuery = useQuery({
    queryKey: ['print-bill-data'],
    queryFn: async () => {
      const [billsRaw, billItemsRaw, paymentsRaw, customersRaw] = await Promise.all([
        pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
        pb.collection('bill_items').getFullList(),
        pb.collection('payments').getFullList({ sort: 'date' }),
        pb.collection('customers').getFullList({ sort: 'company_name,name' }),
      ])

      const itemBaseByBill = new Map<string, number>()
      const itemSummaryByBill = new Map<string, string>()
      const itemRowsByBill = new Map<string, Array<{ itemName: string; qty: number }>>()
      for (const row of billItemsRaw as PBRecord[]) {
        const billId = String(row.bill ?? '')
        itemBaseByBill.set(billId, (itemBaseByBill.get(billId) ?? 0) + num(row.amount))
        const entries = itemRowsByBill.get(billId) ?? []
        entries.push({ itemName: String(row.item_name ?? ''), qty: num(row.qty) })
        itemRowsByBill.set(billId, entries)
      }
      for (const [billId, rows] of itemRowsByBill) {
        const compact = rows
          .filter((entry) => entry.itemName)
          .slice(0, 2)
          .map((entry) => `${entry.itemName} ${Math.round(entry.qty)}kg`)
          .join(', ')
        const moreCount = rows.length > 2 ? ` +${rows.length - 2}` : ''
        itemSummaryByBill.set(billId, compact ? `${compact}${moreCount}` : '-')
      }

      const bills = (billsRaw as PBRecord[]).map(
        (row): BillOption => {
          const customer = (customersRaw as PBRecord[]).find((entry) => entry.id === String(row.customer ?? ''))
          const displayName = customer
            ? formatCustomerDisplayName(customer.company_name, customer.name)
            : String(row.customer_name ?? 'Unknown')
          const printCustomerName = customer
            ? formatCompanyName(customer.company_name, customer.name)
            : String(row.customer_name ?? 'Unknown')
          return {
            id: row.id,
            billRef: String(row.bill_ref ?? ''),
            billNo: num(row.bill_no),
            bookNo: num(row.book_no),
            date: datePart(row.date),
            customerId: String(row.customer ?? ''),
            customerName: displayName,
            printCustomerName,
            mkt: num(row.mkt),
            transport: num(row.transport),
            gstRate: num(row.gst_rate),
            gstAmount: num(row.gst_amount),
            lrNo: String(row.lr_no ?? ''),
            total: calculateBillTotalFromBase(itemBaseByBill.get(row.id) ?? 0, num(row.transport), num(row.gst_rate), num(row.gst_amount)),
            itemSummary: itemSummaryByBill.get(row.id) ?? '-',
          }
        },
      )
      const billItems = (billItemsRaw as PBRecord[]).map(
        (row): BillPrintItem & { billId: string } => ({
          billId: String(row.bill ?? ''),
          itemName: String(row.item_name ?? ''),
          qty: num(row.qty),
          rate: num(row.rate),
          amount: num(row.amount),
          bags: num(row.bags),
        }),
      )
      const payments = (paymentsRaw as PBRecord[]).map((row) => ({
        customerId: String(row.customer ?? ''),
        date: datePart(row.date),
        amount: num(row.amount),
      }))
      const customerOpeningById = new Map(
        (customersRaw as PBRecord[]).map((row) => [row.id, num(row.opening_balance)]),
      )
      return { bills, billItems, payments, customerOpeningById }
    },
  })

  const filteredBills = useMemo(() => {
    const bills = printQuery.data?.bills ?? []
    const q = search.trim().toLowerCase()
    if (!q) return bills
    return bills.filter((bill) => {
      const haystack = `${bill.billRef} ${bill.bookNo}/${bill.billNo} ${bill.date} ${bill.customerName} ${bill.lrNo}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [printQuery.data?.bills, search])

  const selectedBill = useMemo(() => {
    if (!selectedBillId) return null
    return (printQuery.data?.bills ?? []).find((bill) => bill.id === selectedBillId) ?? null
  }, [printQuery.data?.bills, selectedBillId])

  useEffect(() => {
    if (!routeSearch.billId || selectedBillId === routeSearch.billId) return
    setSelectedBillId(routeSearch.billId)
  }, [routeSearch.billId, selectedBillId])

  useEffect(() => {
    if (!routeSearch.billRef) return
    setSearch(routeSearch.billRef)
    const match = (printQuery.data?.bills ?? []).find((bill) => {
      const ref = `${bill.bookNo}/${bill.billNo}`
      return ref === routeSearch.billRef || bill.billRef === routeSearch.billRef
    })
    if (match) setSelectedBillId(match.id)
  }, [routeSearch.billRef, printQuery.data?.bills])

  const preview = useMemo(() => {
    if (!selectedBill || !printQuery.data) return null
    const allCustomerBills = printQuery.data.bills
      .filter((bill) => bill.customerId === selectedBill.customerId && isOnOrBeforeDay(bill.date, selectedBill.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.billNo - b.billNo)
    const currentIdx = allCustomerBills.findIndex((bill) => bill.id === selectedBill.id)
    if (currentIdx < 0) return null

    const itemRows = printQuery.data.billItems.filter((item) => item.billId === selectedBill.id)
    const itemBaseTotal = itemRows.reduce((sum, row) => sum + row.amount, 0)
    const gstAmount = selectedBill.gstAmount > 0 ? selectedBill.gstAmount : (itemBaseTotal * selectedBill.gstRate) / 100
    const currentBillTotal = itemBaseTotal + gstAmount + selectedBill.transport

    const opening = printQuery.data.customerOpeningById.get(selectedBill.customerId) ?? 0

    let previousBalance = opening
    for (let i = 0; i < currentIdx; i += 1) {
      const bill = allCustomerBills[i]
      const rows = printQuery.data.billItems.filter((item) => item.billId === bill.id)
      const base = rows.reduce((sum, row) => sum + row.amount, 0)
      previousBalance += calculateBillTotalFromBase(base, bill.transport, bill.gstRate, bill.gstAmount)
    }
    const previousBillDate = currentIdx > 0 ? allCustomerBills[currentIdx - 1].date : 'Opening'
    const paidBeforePrevious =
      currentIdx > 0
        ? printQuery.data.payments
            .filter(
              (entry) =>
                entry.customerId === selectedBill.customerId && isOnOrBeforeDay(entry.date, allCustomerBills[currentIdx - 1].date),
            )
            .reduce((sum, entry) => sum + entry.amount, 0)
        : 0
    previousBalance -= paidBeforePrevious
    const previousCutoffDate = currentIdx > 0 ? allCustomerBills[currentIdx - 1].date : ''
    const periodCreditEntries = printQuery.data.payments
      .filter((entry) => {
        if (entry.customerId !== selectedBill.customerId) return false
        if (!isOnOrBeforeDay(entry.date, selectedBill.date)) return false
        if (!previousCutoffDate) return true
        return !isOnOrBeforeDay(entry.date, previousCutoffDate)
      })
      .sort((a, b) => a.date.localeCompare(b.date))
    const periodCredits = periodCreditEntries.reduce((sum, entry) => sum + entry.amount, 0)

    const subtotal = previousBalance + currentBillTotal
    const finalTotal = subtotal - periodCredits

    return {
      selectedBill,
      itemRows,
      itemBaseTotal,
      gstAmount,
      currentBillTotal,
      totalQty: itemRows.reduce((sum, row) => sum + row.qty, 0),
      totalBags: itemRows.reduce((sum, row) => sum + row.bags, 0),
      previousBillDate,
      previousBalance,
      periodCreditEntries,
      periodCredits,
      subtotal,
      finalTotal,
      lrList: selectedBill.lrNo
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    }
  }, [printQuery.data, selectedBill])

  function printPreview() {
    if (!previewRef.current) return
    printBillLayoutFromElement(previewRef.current, BILL_PRINT_DOCUMENT_TITLE, setActionStatus)
  }

  async function exportAsJpg() {
    if (!previewRef.current || !preview) return
    try {
      await downloadBillLayoutAsJpg(
        previewRef.current,
        `bill-${preview.selectedBill.bookNo}-${preview.selectedBill.billNo}.jpg`,
      )
      setActionStatus('')
    } catch {
      setActionStatus('Unable to save JPG in this browser session. Please refresh once and retry.')
    }
  }

  async function shareOnWhatsApp() {
    if (!preview || !previewRef.current) return
    const message = [
      `Bill ${preview.selectedBill.bookNo}/${preview.selectedBill.billNo}`,
      `Date: ${formatFullDate(preview.selectedBill.date)}`,
      `Party: ${preview.selectedBill.customerName}`,
      ...(preview.currentBillTotal !== 0 ? [`Current Bill: ${formatInrInteger(preview.currentBillTotal)}`] : []),
      ...(preview.previousBalance !== 0
        ? [`Previous Balance: ${formatInrInteger(preview.previousBalance)} (${preview.previousBillDate === 'Opening' ? 'Opening' : formatFullDate(preview.previousBillDate)})`]
        : []),
      ...preview.periodCreditEntries.map((entry) => `Credited on ${formatFullDate(entry.date)}: ${formatInrInteger(entry.amount)}`),
      `Amount Due: ${formatInrInteger(preview.finalTotal)}`,
    ].join('\n')

    await shareBillLayoutImageWithWhatsAppFallback({
      element: previewRef.current,
      imageFilename: `bill-${preview.selectedBill.bookNo}-${preview.selectedBill.billNo}.jpg`,
      message,
      setStatus: setActionStatus,
    })
  }

  return (
    <div className="w-full px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Bill List</h3>
            <label className="relative w-[280px] max-w-full">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-xs text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter bills..."
              />
            </label>
          </div>
          {printQuery.isLoading && <p className="text-sm text-slate-500">Loading bills...</p>}
          {printQuery.isError && <p className="text-sm text-red-600">Unable to load bill data.</p>}
          {!printQuery.isLoading && !printQuery.isError && (
            <div className="max-h-[72vh] overflow-auto rounded-md border border-slate-100 no-scrollbar">
              <table className="w-full min-w-[640px] sm:min-w-[760px]">
              <thead>
                <tr className="sticky top-0 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bill</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Party</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Items</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-slate-500" colSpan={5}>
                      No bills found for current search.
                    </td>
                  </tr>
                )}
                {filteredBills.map((bill, index) => {
                  const active = selectedBill?.id === bill.id
                  return (
                    <tr
                      key={bill.id}
                      className={`cursor-pointer border-t border-slate-100 ${active ? 'border-l-4 border-l-blue-600 bg-blue-50' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                      onClick={() => setSelectedBillId(bill.id)}
                    >
                      <td className="px-3 py-2 text-sm font-medium text-slate-800">{bill.bookNo}/{bill.billNo}</td>
                      <td className="px-3 py-2 text-sm text-slate-700">{formatFullDate(bill.date)}</td>
                      <td className="px-3 py-2 text-sm text-slate-700">{bill.customerName}</td>
                      <td className="max-w-[230px] truncate px-3 py-2 text-xs text-slate-600" title={bill.itemSummary}>
                        {bill.itemSummary}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-mono text-slate-800">{formatInrInteger(bill.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-7">
          {!preview && (
            <div className="grid min-h-[72vh] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
              <div>
                <p className="text-sm font-semibold text-slate-700">Select a bill from the list to preview</p>
                <p className="mt-1 text-xs text-slate-500">Then you can print, export JPG, or share on WhatsApp.</p>
              </div>
            </div>
          )}

          {preview && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Preview Bill {preview.selectedBill.bookNo}/{preview.selectedBill.billNo}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={printPreview}>
                    <Printer size={14} />
                    Print
                  </button>
                  <Link
                    to="/transactions"
                    search={{ focusKind: 'bill', focusId: preview.selectedBill.id }}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <Edit3 size={14} />
                    Edit
                  </Link>
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={() => void exportAsJpg()}>
                    <Download size={14} />
                    JPG
                  </button>
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={shareOnWhatsApp}>
                    <Share2 size={14} />
                    WhatsApp
                  </button>
                </div>
              </div>
              {actionStatus && <p className="mb-2 text-xs text-slate-500">{actionStatus}</p>}
              <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-100 p-1">
                <div className="flex justify-center px-1 py-2">
                  <div
                    ref={previewRef}
                    className={BILL_PREVIEW_CARD_CLASS}
                    style={{ width: `${BILL_PRINT_PAGE_WIDTH_CM}cm`, maxWidth: '100%' }}
                  >
                    <BillPrintLayout
                      bookNo={preview.selectedBill.bookNo}
                      billNo={preview.selectedBill.billNo}
                      date={preview.selectedBill.date}
                      customerName={preview.selectedBill.printCustomerName}
                      mkt={preview.selectedBill.mkt}
                      itemRows={preview.itemRows}
                      gstAmount={preview.gstAmount}
                      transport={preview.selectedBill.transport}
                      gstRate={preview.selectedBill.gstRate}
                      currentBillTotal={preview.currentBillTotal}
                      previousBalance={preview.previousBalance}
                      previousBillDate={preview.previousBillDate}
                      periodCreditEntries={preview.periodCreditEntries}
                      subtotal={preview.subtotal}
                      finalTotal={preview.finalTotal}
                      totalQty={preview.totalQty}
                      totalBags={preview.totalBags}
                      lrList={preview.lrList}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
