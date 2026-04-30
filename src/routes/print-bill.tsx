import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer, Search, Share2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { formatFullDate } from '@/lib/date'
import { exportNodeAsJpg, exportNodeAsJpgBlob } from '@/lib/image-export'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/print-bill')({
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
  mkt: number
  transport: number
  gstRate: number
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
const BILL_PAGE_WIDTH_CM = 14

function printHtmlWithoutPopup(html: string) {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)
  const frameDoc = frame.contentDocument
  if (!frameDoc) return false
  frameDoc.open()
  frameDoc.write(html)
  frameDoc.close()
  window.setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 500)
  }, 80)
  return true
}

function PrintBillPage() {
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
        pb.collection('customers').getFullList({ sort: 'name' }),
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
        (row): BillOption => ({
          id: row.id,
          billRef: String(row.bill_ref ?? ''),
          billNo: num(row.bill_no),
          bookNo: num(row.book_no),
          date: datePart(row.date),
          customerId: String(row.customer ?? ''),
          customerName: String(row.customer_name ?? 'Unknown'),
          mkt: num(row.mkt),
          transport: num(row.transport),
          gstRate: num(row.gst_rate),
          lrNo: String(row.lr_no ?? ''),
          total: calculateBillTotalFromBase(itemBaseByBill.get(row.id) ?? 0, num(row.transport), num(row.gst_rate)),
          itemSummary: itemSummaryByBill.get(row.id) ?? '-',
        }),
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

  const bills = printQuery.data?.bills ?? []

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bills
    return bills.filter((bill) => {
      const haystack = `${bill.billRef} ${bill.bookNo}/${bill.billNo} ${bill.date} ${bill.customerName} ${bill.lrNo}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [bills, search])

  const selectedBill = useMemo(() => {
    if (!selectedBillId) return null
    return filteredBills.find((bill) => bill.id === selectedBillId) ?? null
  }, [filteredBills, selectedBillId])

  const preview = useMemo(() => {
    if (!selectedBill || !printQuery.data) return null
    const allCustomerBills = printQuery.data.bills
      .filter((bill) => bill.customerId === selectedBill.customerId && isOnOrBeforeDay(bill.date, selectedBill.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.billNo - b.billNo)
    const currentIdx = allCustomerBills.findIndex((bill) => bill.id === selectedBill.id)
    if (currentIdx < 0) return null

    const itemRows = printQuery.data.billItems.filter((item) => item.billId === selectedBill.id)
    const itemBaseTotal = itemRows.reduce((sum, row) => sum + row.amount, 0)
    const gstAmount = (itemBaseTotal * selectedBill.gstRate) / 100
    const currentBillTotal = itemBaseTotal + gstAmount + selectedBill.transport

    const opening = printQuery.data.customerOpeningById.get(selectedBill.customerId) ?? 0

    let previousBalance = opening
    for (let i = 0; i < currentIdx; i += 1) {
      const bill = allCustomerBills[i]
      const rows = printQuery.data.billItems.filter((item) => item.billId === bill.id)
      const base = rows.reduce((sum, row) => sum + row.amount, 0)
      previousBalance += calculateBillTotalFromBase(base, bill.transport, bill.gstRate)
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
    const printHtml = `
      <html>
        <head>
          <title>Print Bill</title>
          <style>
            @page { margin: 0.25cm; }
            body { margin: 0; padding: 0.25cm; font-family: Arial, sans-serif; color: #0f172a; background: #fff; }
            .preview-print { width: ${BILL_PAGE_WIDTH_CM - 0.5}cm; margin: 0 auto; }
            table { border-collapse: collapse; width: 100%; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
            .amount { text-align: right; font-family: monospace; }
          </style>
        </head>
        <body><div class="preview-print">${previewRef.current.innerHTML}</div></body>
      </html>
    `
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=800')
    if (!printWindow) {
      const usedIframeFallback = printHtmlWithoutPopup(printHtml)
      setActionStatus(
        usedIframeFallback
          ? 'Popup blocked. Used in-page print fallback.'
          : 'Print is blocked by browser settings. Please allow print popups.',
      )
      return
    }
    printWindow.document.write(printHtml)
    printWindow.document.close()
    window.setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 50)
    setActionStatus('')
  }

  async function exportAsJpg() {
    if (!previewRef.current || !preview) return
    try {
      await exportNodeAsJpg(previewRef.current, {
        filename: `bill-${preview.selectedBill.bookNo}-${preview.selectedBill.billNo}.jpg`,
        quality: 0.95,
        preferredWidthPx: 1080,
        maxHeightPx: 2800,
      })
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

    try {
      if (typeof navigator.share === 'function') {
        const blob = await exportNodeAsJpgBlob(previewRef.current, {
          quality: 0.95,
          preferredWidthPx: 1080,
          maxHeightPx: 2800,
        })
        const filename = `bill-${preview.selectedBill.bookNo}-${preview.selectedBill.billNo}.jpg`
        const file = new File([blob], filename, { type: 'image/jpeg' })
        const sharePayload: ShareData = { text: message, files: [file] }
        if (!navigator.canShare || navigator.canShare(sharePayload)) {
          await navigator.share(sharePayload)
          setActionStatus('')
          return
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setActionStatus('')
        return
      }
      // Fall through to WhatsApp text sharing fallback.
    }

    const shareWindow = window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
    if (!shareWindow) {
      setActionStatus('Could not open share options. Please allow popups and retry.')
      return
    }
    setActionStatus('Image share is not supported in this browser. WhatsApp opened with text.')
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
                <div
                  ref={previewRef}
                  className="mx-auto rounded-lg border border-slate-300 bg-white p-4"
                  style={{ width: `${BILL_PAGE_WIDTH_CM}cm` }}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Kapil Products</p>
                      <p className="text-xs text-slate-600">MKT: {preview.selectedBill.mkt}</p>
                    </div>
                    <div className="text-right text-xs text-slate-600">
                      <p>Date: {formatFullDate(preview.selectedBill.date)}</p>
                      <p>No: {preview.selectedBill.bookNo}/{preview.selectedBill.billNo}</p>
                    </div>
                  </div>

                  <p className="mb-2 text-sm text-slate-700">M/s. <span className="font-semibold text-slate-900">{preview.selectedBill.customerName}</span></p>

                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border border-slate-300 px-2 py-1 text-left">Particulars</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">Qty</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">Rate</th>
                        <th className="border border-slate-300 px-2 py-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.itemRows.map((row, index) => (
                        <tr key={`${row.itemName}-${index}`}>
                          <td className="border border-slate-300 px-2 py-1">{row.itemName}</td>
                          <td className="border border-slate-300 px-2 py-1 text-right">{row.qty} kg</td>
                          <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(row.rate)}</td>
                          <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(row.amount)}</td>
                        </tr>
                      ))}
                      {preview.gstAmount > 0 && (
                        <tr>
                          <td className="border border-slate-300 px-2 py-1">GST ({preview.selectedBill.gstRate}%)</td>
                          <td className="border border-slate-300 px-2 py-1" />
                          <td className="border border-slate-300 px-2 py-1" />
                          <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(preview.gstAmount)}</td>
                        </tr>
                      )}
                      {preview.selectedBill.transport > 0 && (
                        <tr>
                          <td className="border border-slate-300 px-2 py-1">Transport</td>
                          <td className="border border-slate-300 px-2 py-1" />
                          <td className="border border-slate-300 px-2 py-1" />
                          <td className="border border-slate-300 px-2 py-1 text-right">+ {formatInrInteger(preview.selectedBill.transport)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div className="my-3 border-t border-slate-300" />
                  <div className="space-y-1.5 text-xs">
                    {preview.currentBillTotal !== 0 && (
                      <div className="flex items-center justify-between">
                        <span>Current Bill Total</span>
                        <span className="font-mono font-semibold">{formatInrInteger(preview.currentBillTotal)}</span>
                      </div>
                    )}
                    {preview.previousBalance !== 0 && (
                      <div className="flex items-center justify-between">
                        <span>Previous Balance [dt. {preview.previousBillDate === 'Opening' ? 'Opening' : formatFullDate(preview.previousBillDate)}]</span>
                        <span className="font-mono">+ {formatInrInteger(preview.previousBalance)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span>Sub Total</span>
                      <span className="font-mono">{formatInrInteger(preview.subtotal)}</span>
                    </div>
                    {preview.periodCreditEntries.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                        {preview.periodCreditEntries.map((entry, index) => (
                          <div key={`${entry.date}-${entry.amount}-${index}`} className="flex items-center justify-between text-[11px] text-slate-600">
                            <span>Credited on {formatFullDate(entry.date)}</span>
                            <span className="font-mono">- {formatInrInteger(entry.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-300 pt-1.5 text-base font-bold">
                      <span>Total</span>
                      <span className="font-mono">{formatInrInteger(preview.finalTotal)}</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Weight</p>
                      <p className="font-semibold text-slate-800">{Math.round(preview.totalQty)} kg</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Bags</p>
                      <p className="font-semibold text-slate-800">{Math.round(preview.totalBags)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">LR No.</p>
                      <p className="font-semibold text-slate-800">{preview.lrList.length ? preview.lrList.join(', ') : '-'}</p>
                    </div>
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
