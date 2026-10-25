import { pb } from '@/data/pocketbase'
import { loadCustomerAutoBalanceContext } from '@/data/customer-balance'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { BILL_PREVIEW_CARD_CLASS, createBillLayoutShareJpegBlob } from '@/lib/bill-print-export'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { formatCompanyName } from '@/lib/customer-display'

type PBRecord = Record<string, unknown> & { id: string }

const datePart = (val: unknown): string => String(val ?? '').slice(0, 10)
const num = (val: unknown): number => (Number.isFinite(Number(val)) ? Number(val) : 0)

// In-memory guard to prevent recursive uploads
const activeUploads = new Set<string>()

export async function renderAndUploadBillJpg(billId: string): Promise<string | null> {
  if (!billId || activeUploads.has(billId)) return null
  if (typeof window === 'undefined' || typeof document === 'undefined') return null

  activeUploads.add(billId)
  try {
    const selectedBill = (await pb.collection('bills').getOne(billId)) as PBRecord
    const customerId = String(selectedBill.customer ?? '')

    const [customer, billItems, masterItems, balance] = await Promise.all([
      customerId ? (pb.collection('customers').getOne(customerId).catch(() => null) as Promise<PBRecord | null>) : null,
      pb.collection('bill_items').getFullList({ filter: `bill = "${billId}"` }) as Promise<PBRecord[]>,
      pb.collection('items').getFullList({ sort: 'name' }) as Promise<PBRecord[]>,
      customerId
        ? loadCustomerAutoBalanceContext(customerId, datePart(selectedBill.date))
        : Promise.resolve({ previousBalanceDate: 'Opening', previousBalanceAmount: 0, credits: [] }),
    ])

    const selectedDate = datePart(selectedBill.date)
    const previousBalance = balance.previousBalanceAmount
    const previousBillDate = balance.previousBalanceDate
    const periodCreditEntries = balance.credits.map((c) => ({ date: c.date, amount: c.amount }))

    const itemRows = billItems.map((item: PBRecord) => {
      const master = masterItems.find(
        (m: PBRecord) => m.id === item.item || String(m.name ?? '').trim().toLowerCase() === String(item.item_name ?? '').trim().toLowerCase()
      )
      return {
        itemName: String(item.item_name ?? ''),
        qty: num(item.qty),
        rate: num(item.rate),
        amount: num(item.amount),
        bags: num(item.bags),
        type: String(master?.type ?? ''),
        unit: String(master?.unit ?? ''),
        bagWeight: num(master?.bag_weight) || 50,
      }
    })

    const itemBaseTotal = itemRows.reduce((sum: number, row) => sum + row.amount, 0)
    const gstRate = num(selectedBill.gst_rate)
    const gstAmount = num(selectedBill.gst_amount) > 0 ? num(selectedBill.gst_amount) : (itemBaseTotal * gstRate) / 100
    const transport = num(selectedBill.transport)
    const currentBillTotal = calculateBillTotalFromBase(itemBaseTotal, transport, gstRate, num(selectedBill.gst_amount) > 0 ? num(selectedBill.gst_amount) : null)

    const totalCredits = periodCreditEntries.reduce((s: number, c) => s + c.amount, 0)
    const subtotal = previousBalance + currentBillTotal
    const finalTotal = subtotal - totalCredits

    const lrList = selectedBill.lr_no
      ? String(selectedBill.lr_no).split(',').map((s) => s.trim()).filter(Boolean)
      : []

    const props: BillPrintLayoutProps = {
      bookNo: num(selectedBill.book_no),
      billNo: num(selectedBill.bill_no),
      date: selectedDate,
      customerName: customer ? formatCompanyName(customer.company_name, customer.name) : String(selectedBill.customer_name ?? ''),
      mkt: num(selectedBill.mkt),
      itemRows,
      gstAmount,
      transport,
      gstRate,
      currentBillTotal,
      previousBalance,
      previousBillDate,
      periodCreditEntries,
      subtotal,
      finalTotal,
      totalQty: itemRows.reduce((sum: number, r) => sum + r.qty, 0),
      totalBags: itemRows.reduce((sum: number, r) => sum + r.bags, 0),
      lrList,
    }

    // Mount off-screen
    const host = document.createElement('div')
    host.style.position = 'fixed'
    host.style.left = '-10000px'
    host.style.top = '0'
    host.style.width = `${BILL_PRINT_PAGE_WIDTH_CM}cm`
    host.style.background = '#ffffff'
    const card = document.createElement('div')
    card.className = BILL_PREVIEW_CARD_CLASS
    card.style.width = `${BILL_PRINT_PAGE_WIDTH_CM}cm`
    host.appendChild(card)
    document.body.appendChild(host)

    const { createRoot } = await import('react-dom/client')
    const root = createRoot(card)

    let blob: Blob
    try {
      root.render(<BillPrintLayout {...props} />)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 80))
      })
      blob = await createBillLayoutShareJpegBlob(card)
    } finally {
      try {
        root.unmount()
      } catch {}
      host.remove()
    }

    const formData = new FormData()
    const filename = `bill-${selectedBill.book_no}-${selectedBill.bill_no}.jpg`
    formData.append('bill_jpg', blob, filename)

    const updated = await pb.collection('bills').update(billId, formData)
    return String(updated.bill_jpg ?? '')
  } catch (error) {
    console.warn('[bill-jpg] Failed to render and upload bill JPG', error)
    return null
  } finally {
    activeUploads.delete(billId)
  }
}
