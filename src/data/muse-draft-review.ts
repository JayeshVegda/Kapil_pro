import { pb } from './pocketbase'
import { loadPendingBillDraftForReview } from './bill-drafts'
import { getCustomerBookSelection, getNextBillNoForBook, saveBillWithItems } from './bills'
import { loadCustomerAutoBalanceContext } from './customer-balance'
import { loadCustomerPaymentLedger } from './payments'
import { loadPurchaseBillDraft } from './purchase-bill-drafts'
import { loadPurchasePaymentDraft } from './purchase-payment-drafts'
import { approveMuseOpeningBalance, approveMusePurchaseAction, type MusePurchaseActionRecord } from './muse-purchase-action-drafts'
import { loadCastingSessionDraft } from './casting-session-drafts'
import { loadCastingMaterials, normalizeBatchesForSave, saveCastingSession, type SaveCastingSessionPayload } from './casting'
import { savePaymentFromDraft } from './payment-drafts'
import { createPurchaseBill, createSupplierPayment, getNextPurchaseInNo, loadPurchaseBill, loadPurchaseReadModel, loadSupplierBundle, listPurchaseItems, listSuppliers } from './suppliers'
import { buildPaymentDraftView, composeReceiptNote, type PaymentDraftRecordInput } from '@/domain/payment-drafts'
import { buildPaymentPreview } from '@/domain/payment-ledger'
import { prepareMusePurchaseAction, type OpeningBalanceValues } from '@/domain/muse-purchase-actions'
import { calculateBillingLineBags, getBillingUnit } from '@/domain/billing-modes'
import { calculateBillTotals, calculateLineAmount } from '@/domain/billing-calculations'
import { buildBillPreviewProps } from '@/lib/bill-preview-props'
import type { BillChittyData } from '@/components/suppliers/bill-chitty'
import { buildPurchaseBillPresentation, hasPurchasePaymentNote, purchaseChittyCreditLabel } from '@/components/suppliers/purchase-bill-presentation'
import { calculateDraftLinePaise, matchPurchaseMaster } from '@/domain/purchase-bill-draft'
import { parseBagsAtReceiptKg, formatPrivateNoteWithBags, computeBillNet } from '@/domain/supplier-purchases'
import { computeSupplierSettlement } from '@/domain/supplier-settlement'
import { bundleToSettlementInput } from '@/domain/supplier-bundle'
import { purchaseReceiptBagCount, purchaseReceiptMemoText, remainingPurchaseBags } from '@/domain/purchase-receipt-memos'
import { buildSupplierPaymentWorkflow, prepareSupplierPaymentInput, type SupplierPaymentDraft } from '@/domain/supplier-payment-workflow'
import { matchCastingMaterial } from '@/domain/casting-session-draft'
import { calculateCastingCost } from '@/domain/casting-calculations'
import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { formatPaiseInr } from '@/lib/inr-format'
import { formatFullDate } from '@/lib/date'

const tables = {
  'sales-bill': 'bill_drafts', 'sales-payment': 'payment_drafts', 'purchase-bill': 'purchase_bill_drafts',
  'purchase-payment': 'purchase_payment_drafts', 'purchase-action': 'muse_purchase_action_drafts', 'casting-session': 'casting_session_drafts',
} as const
export type ReviewSource = keyof typeof tables
type Info = { party: string; date: string; amount: string; details?: string[] }
type Review = { info: Info; raw: string; fingerprint: string; commit: (values?: OpeningBalanceValues) => Promise<unknown>; opening?: OpeningBalanceValues } & (
  { view: 'sales-bill'; preview: ReturnType<typeof buildBillPreviewProps> } |
  { view: 'purchase-bill'; preview: BillChittyData } |
  { view: 'casting'; preview: CastingSessionWithInputs } |
  { view: 'summary' }
)

function ready(status: string, processed: boolean = false) {
  if (status !== 'pending_review' || processed) throw new Error('This draft was already processed.')
}

export async function rejectReviewedDraft(source: ReviewSource, id: string, reason: string) {
  const explanation = reason.trim()
  if (!explanation || explanation.length > 1000) throw new Error('Enter a rejection reason (1–1000 characters).')
  const service = pb.collection(tables[source])
  const record = await service.getOne(id)
  ready(String(record.status))
  if (!('rejection_reason' in record)) throw new Error('Update the Muse database before rejecting a draft.')
  await service.update(id, { status: 'rejected', rejection_reason: explanation })
}

const rs = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
export function buildDraftCastingTicket(payload: SaveCastingSessionPayload): CastingSessionWithInputs {
  const coalKg = payload.coalKg ?? 0, coalRate = payload.coalRate ?? 0, workerSalary = payload.workerSalary ?? 0
  const batches = normalizeBatchesForSave(payload)
  const formulaVersion = payload.costFormulaVersion ?? 2
  const cost = calculateCastingCost({ batches, coalKg, coalRate, workerSalary, formulaVersion })
  const ticketBatches = batches.map((batch) => ({
    ...batch, id: String(batch.batchNumber), sessionId: 'preview',
    inputs: batch.inputs.map((row, i) => ({ ...row, id: `${batch.batchNumber}-${i}`, sessionId: 'preview', amount: row.qty * row.rate })),
  }))
  return {
    id: 'preview', date: payload.date, note: payload.note, coalKg, coalRate, workerSalary,
    costFormulaVersion: formulaVersion, createdAt: '', updatedAt: '', cholIn: payload.cholIn ?? 0,
    unit: batches.length, wireOut: cost.totalWireOut, totalWireOut: cost.totalWireOut,
    wastage: cost.totalMel, totalMel: cost.totalMel, costPerKg: cost.finalCastingCostPerKg,
    metalCostPerKg: cost.metalCostPerKg, coalCostPerKg: cost.coalCostPerKg, workerCostPerKg: cost.workerCostPerKg,
    finalProductCostPerKg: cost.finalProductCostPerKg, totalInputCost: cost.totalInputCost, totalInputKg: cost.totalInputKg,
    batches: ticketBatches, inputs: ticketBatches.flatMap((b) => b.inputs),
  }
}

export async function prepareMuseDraftReview(source: ReviewSource, id: string): Promise<Review> {
  function evidence<T>(view: T, raw: string, info: Info, snapshot: unknown, commit: (values?: OpeningBalanceValues) => Promise<unknown>, preview?: unknown) {
    return { view, raw, info, fingerprint: JSON.stringify({ snapshot, info, preview }), commit, ...(preview ? { preview } : {}) } as Review
  }
  if (source === 'sales-bill') {
    const d = await loadPendingBillDraftForReview(id)
    const isNew = d.muse_new_customer === true
    if (!d.date || !d.customer_name || (!isNew && !d.customer)) throw new Error('Select a valid customer and bill date in the editor.')
    if (!d.items.length || d.items.some((x) => !x.itemId || x.qty <= 0 || x.rate <= 0)) throw new Error('Load the bill to resolve its items or missing rates before saving.')
    const buyer = isNew ? null : await pb.collection('customers').getOne(d.customer!)
    if (buyer?.active === false) throw new Error('The customer is inactive.')
    const customerId = isNew ? d.id : d.customer!
    const customerName = String(buyer?.company_name || buyer?.name || d.customer_name)
    const bookNo = d.book_no || (isNew ? 0 : (await getCustomerBookSelection(customerId))?.bookNo ?? 0) || 69
    const billNo = d.bill_no || await getNextBillNoForBook(bookNo)
    if (!billNo) throw new Error('This book has no next bill number. Load the draft and choose a book.')
    const items = await Promise.all(d.items.map(async (x) => {
      const item = await pb.collection('items').getOne(x.itemId)
      if (item.active === false) throw new Error('An item is inactive. Load the draft to resolve it.')
      return { ...x, itemName: String(item.name), type: String(item.type ?? ''), unit: String(item.unit ?? ''), bagWeight: Number(item.bag_weight) }
    }))
    const input = {
      draftId: id, newCustomer: isNew, bookNo, billNo, date: d.date.slice(0, 10), customerId, customerName, items, payments: d.payments,
      mktRate: Number(d.mkt ?? 0), transport: Number(d.transport ?? 0), gstRate: Number(d.gst_rate ?? (d.gst_mode === 'percent18' ? 18 : 0)),
      gstAmount: Number(d.gst_amount ?? 0), lrList: (d.lr_no ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    }
    const totals = calculateBillTotals({ ...input, gstAmountOverride: input.gstAmount })
    const balance = isNew ? null : await loadCustomerAutoBalanceContext(customerId, input.date)
    const rows = items.map((x) => ({ ...x, bags: calculateBillingLineBags({ qty: x.qty, item: x }), amount: calculateLineAmount(x), unit: getBillingUnit(x) }))
    return evidence('sales-bill', d.raw_text ?? '', { party: customerName, date: input.date, amount: rs.format(totals.grandTotal) }, input,
      () => saveBillWithItems(input), buildBillPreviewProps({
        ...input, gstAmount: totals.gstAmount, currentBillTotal: totals.grandTotal, balance, itemRows: rows, totalQty: totals.totalQty,
        totalBags: rows.reduce((sum, row) => sum + row.bags, 0), quickPayments: d.payments.map((p, i) => ({ ...p, id: `draft-${i}` })),
      }))
  }
  if (source === 'sales-payment') {
    const raw = await pb.collection('payment_drafts').getOne<PaymentDraftRecordInput>(id)
    ready(String(raw.status))
    if (raw.mode !== 'Cash' && raw.mode !== 'Bank') throw new Error('Load the receipt and choose a payment mode.')
    const d = buildPaymentDraftView(raw)
    if (!d.customerId || !d.date || !d.amount) throw new Error('Load the receipt to select the customer, date and amount.')
    const ledger = await loadCustomerPaymentLedger(d.customerId, d.date)
    const preview = buildPaymentPreview({ ...ledger, asOfDate: d.date, paymentAmount: d.amount })
    const input = { ...d, draftId: id, customerName: ledger.customerName, note: composeReceiptNote(d.date, d.note) }
    return evidence('summary', d.rawText, { party: input.customerName, date: d.date, amount: rs.format(d.amount),
      details: [`Mode: ${d.mode}`, `Balance before: ${rs.format(preview.outstandingBeforePayment)}`,
        `Balance after: ${rs.format(preview.outstandingAfterPayment)}`],
    }, input, () => savePaymentFromDraft(input))
  }
  if (source === 'casting-session') {
    const d = await loadCastingSessionDraft(id)
    ready(d.status)
    if (d.parsed.kind === 'invalid') throw new Error(d.parsed.issues.join('; '))
    const p = d.parsed
    const materials = await loadCastingMaterials()
    const batches = p.batches.map((batch) => {
      if (batch.wireOut <= 0 || !batch.inputs.length) throw new Error('Load the session to complete material inputs and wire out.')
      return { ...batch, inputs: batch.inputs.map((row) => {
        const matched = matchCastingMaterial(row.materialName, row.materialId, materials)
        if (!matched || !matched.isActive || row.qty <= 0 || row.rate <= 0) throw new Error('Load the session to match its materials and complete quantities and rates.')
        return { ...row, materialName: matched.name, materialId: matched.id }
      }) }
    })
    const payload = { draftId: id, date: p.value.date, note: p.value.note ?? '', coalKg: p.coalKg, coalRate: p.coalRate, workerSalary: p.workerSalary, batches }
    const preview = buildDraftCastingTicket(payload)
    return evidence('casting', d.raw_text, { party: 'Casting session', date: payload.date, amount: `${preview.totalWireOut.toFixed(3)} kg wire out` },
      payload, () => saveCastingSession(payload), preview)
  }
  if (source === 'purchase-action') {
    const record = await pb.collection('muse_purchase_action_drafts').getOne<MusePurchaseActionRecord>(id)
    ready(record.status)
    const action = prepareMusePurchaseAction(record.payload)
    if (action.kind === 'opening_balance') {
      const { supplier, bills, payments } = await loadSupplierBundle(action.supplierId)
      if (!supplier.active) throw new Error('This supplier is inactive.')
      if (supplier.openingBalanceDate || supplier.openingKachaPaise || supplier.openingGstPaise || bills.length || payments.length)
        throw new Error('Supplier already has an opening balance or activity. Review it manually in Kapil.')
      const values = { date: action.date, kachaPaise: action.kachaPaise, gstPaise: action.gstPaise }
      const label = (amount: number) => amount === 0 ? 'None' : `${formatPaiseInr(Math.abs(amount))} ${amount > 0 ? 'payable' : 'advance'}`
      return { ...evidence('summary', record.raw_text, {
        party: supplier.companyName, date: action.date, amount: 'Supplier opening balance',
        details: [`Kacha: ${label(values.kachaPaise)}`, `GST: ${label(values.gstPaise)}`, 'This sets the starting ledger balance. It creates no bill or payment.'],
      }, { action, supplier: supplier.companyName }, (edited) => approveMuseOpeningBalance(id, supplier.companyName, edited ?? values)), opening: values }
    }
    if (action.kind === 'bardan') {
      const target = await loadPurchaseBill(action.billId)
      const line = target.lines.find((x) => x.id === action.lineId)
      if (!line || target.bill.cancelled || line.rateMilli !== action.rateMilli) throw new Error('The proposed bardan rate or slip changed.')
      const previouslyUnrecorded = purchaseReceiptBagCount(line.receiptMemo) === 0 && target.bardan.length === 0
      if (!previouslyUnrecorded && action.bagCount > remainingPurchaseBags(line, target.bardan)) throw new Error('The remaining bag count changed. Load the draft to review it.')
      const context = (await loadPurchaseReadModel()).supplierContexts.get(target.bill.supplierId)
      if (!context) throw new Error('Supplier balance could not be loaded.')
      const entry = {
        id: 'preview-bardan', billId: target.bill.id, rateLineId: line.id, bagCount: action.bagCount,
        bardanG: action.weightG, rateMilli: action.rateMilli, method: action.method, creditPaise: action.creditPaise,
        cashAmountPaise: 0, date: action.date, note: '', cancelled: false, created: '', updated: '',
      }
      const bundle = { ...context.bundle, bardan: [...context.bundle.bardan, entry] }
      const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
      const preview = buildPurchaseBillPresentation({ ...target, bardan: [...target.bardan, entry] }, { ...context, bundle, settlement })?.chitty
      if (!preview) throw new Error('The purchase chitti could not be built.')
      return evidence('purchase-bill', record.raw_text, { party: target.bill.inNo, date: action.date, amount: formatPaiseInr(action.creditPaise),
        details: [`${line.itemName} · ${action.bagCount} bags · ${(action.weightG / 1000).toFixed(3)} kg total`, action.method === 'deduct' ? 'Deduct from this bill' : 'Settle in kind'],
      }, { action, target }, () => approveMusePurchaseAction(record), preview)
    }
    const p = action.bill
    const gstRateBp = p.gst_rate_bp ?? (p.pool === 'gst' ? 1800 : 0)
    const lines = p.lines.map((line) => ({ itemName: line.item_name, amountPaise: line.amount_paise, weightG: line.weight_g, rateMilli: line.rate_milli, bardanText: line.receipt_memo }))
    const preview: BillChittyData = { supplierName: p.supplier_name, date: p.date, pool: p.pool, taxMode: p.tax_mode, gstRateBp,
      inNo: await getNextPurchaseInNo(p.date), supplierBillNo: p.supplier_bill_no ?? '', lines, adjustments: [], bardan: [], paidRows: [] }
    const total = computeBillNet(lines, [], [], p.tax_mode, gstRateBp).netPaise
    return evidence('purchase-bill', record.raw_text, { party: p.supplier_name, date: p.date, amount: formatPaiseInr(total), details: ['Legacy proposal: creates the supplier and first bill together.'] },
      action, () => approveMusePurchaseAction(record, preview.inNo), preview)
  }

  const d = source === 'purchase-bill' ? await loadPurchaseBillDraft(id) : await loadPurchasePaymentDraft(id)
  ready(d.status)
  if (d.parsed.kind === 'invalid') throw new Error(d.parsed.issues.join('; '))
  const p = d.parsed.value
  const suppliers = await listSuppliers({ includeInactive: false })
  const match = matchPurchaseMaster(p.supplier_name, p.supplier_id, suppliers.map((s) => ({ ...s, name: s.companyName })))
  if (!match) throw new Error(d.supplier_draft ? 'Approve the linked supplier first.' : 'Load the draft to select the correct supplier.')
  const context = (await loadPurchaseReadModel()).supplierContexts.get(match.id)
  if (!context) throw new Error('Supplier balance could not be loaded.')
  if ('amount_rs' in p) {
    if (!p.mode || !('amountPaise' in d.parsed)) throw new Error('Load the payment draft to complete its payment mode.')
    const payment: SupplierPaymentDraft = {
      supplierId: match.id, date: p.date, pool: p.pool, kind: p.kind, mode: p.mode, amountPaise: d.parsed.amountPaise,
      reference: p.reference ?? '', payeeName: p.payee ?? '', privateNote: p.note ?? '',
    }
    const workflow = buildSupplierPaymentWorkflow(context, { ...payment, selectedBillIds: new Set(p.bill_pins ?? []) })
    if ((p.bill_pins?.length ?? 0) !== workflow.allocationPreview.lines.filter((row) => workflow.selectedBillIds.has(row.billId)).length) {
      throw new Error('A requested payment allocation no longer matches an open bill. Load the draft to review.')
    }
    const input = { ...prepareSupplierPaymentInput(payment, workflow), draftId: id }
    return evidence('summary', d.raw_text, { party: match.name, date: p.date, amount: formatPaiseInr(payment.amountPaise), details: [
      `${payment.pool.toUpperCase()} · ${payment.kind.replaceAll('_', ' ')} · ${payment.mode}`,
      `Payable before: ${formatPaiseInr(workflow.outstandingBefore)}`,
      `Payable after: ${formatPaiseInr(workflow.allocationPreview.outstandingAfterPaise)}`,
      `Advance after: ${formatPaiseInr(workflow.allocationPreview.advancePaise)}`,
    ] }, input, () => createSupplierPayment(input))
  }
  const items = await listPurchaseItems()
  const lines = p.lines.map((line) => {
    const found = matchPurchaseMaster(line.item_name, line.item_id, items)
    if (!found) throw new Error('Load the draft to resolve unmatched item: ' + line.item_name)
    const amountPaise = calculateDraftLinePaise(line.weight_g, line.rate_milli)
    if (amountPaise !== line.amount_paise) throw new Error('A line amount differs from weight × rate. Review it in the editor.')
    return { itemId: found.id, itemName: found.name, weightG: line.weight_g, rateMilli: line.rate_milli, amountPaise, receiptMemo: line.receipt_memo }
  })
  const gstRateBp = p.tax_mode === 'none' ? 0 : p.gst_rate_bp ?? 1800
  const bardan = (p.bardan ?? []).map((row) => ({
    bardanG: row.bardan_g, rateLineIndex: row.rate_line_index, rateMilli: row.rate_milli, method: row.method,
    creditPaise: row.credit_paise ?? (row.method === 'deduct' ? calculateDraftLinePaise(row.bardan_g, row.rate_milli) : 0),
    cashAmountPaise: row.cash_amount_paise ?? 0, date: row.date || p.date, note: row.note ?? '',
    itemName: row.rate_line_index === undefined ? undefined : lines[row.rate_line_index]?.itemName,
  }))
  if (bardan.some((b) => b.method === 'advance')) throw new Error('Load the bill to review a bardan advance before saving.')
  const adjustments = (p.adjustments ?? []).map((a) => ({ type: a.type, amountPaise: a.amount_paise, note: a.note }))
  const payment = p.payment ? { amountPaise: p.payment.amount_paise, date: p.date, mode: p.payment.mode, note: p.payment.note, reference: p.payment.reference } : undefined
  const net = computeBillNet(lines, adjustments, bardan, p.tax_mode, gstRateBp)
  if (p.stated_total_paise !== undefined && p.stated_total_paise !== net.netPaise) throw new Error('Stated total differs from Kapil’s calculation. Load the bill to resolve it.')
  const input = {
    draftId: id, supplierId: match.id, date: p.date, inNo: await getNextPurchaseInNo(p.date), pool: p.pool,
    taxMode: p.tax_mode, gstRateBp, supplierBillNo: p.supplier_bill_no ?? '', vehicleNo: p.vehicle_no,
    privateNote: formatPrivateNoteWithBags(p.private_note ?? '', p.bags_at_receipt_g ? p.bags_at_receipt_g / 1000 : null),
    lines, bardan, adjustments, payment,
  }
  const bundle = bundleToSettlementInput(context.bundle)
  const billId = 'preview-bill', paymentId = 'preview-payment', created = '9999-12-31 23:59:59'
  const simulated = computeSupplierSettlement({
    ...bundle, bills: [...bundle.bills, { id: billId, date: p.date, created, pool: p.pool, taxMode: p.tax_mode, gstRateBp }],
    lines: [...bundle.lines, ...lines.map((line) => ({ billId, amountPaise: line.amountPaise }))],
    adjustments: [...bundle.adjustments, ...adjustments.map((a) => ({ ...a, billId }))],
    bardan: [...bundle.bardan, ...bardan.map((a) => ({ ...a, billId }))],
    payments: [...bundle.payments, ...(payment ? [{ id: paymentId, date: p.date, created, amountPaise: payment.amountPaise, kind: 'payment', pool: p.pool }] : [])],
    allocations: [...bundle.allocations, ...(payment && net.netPaise > 0 ? [{ billId, paymentId, amountPaise: Math.min(payment.amountPaise, net.netPaise) }] : [])],
  }).pools[p.pool]
  const paidRows = (simulated.bills.find((bill) => bill.billId === billId)?.creditsApplied ?? []).map((credit) => {
    const stored = context.bundle.payments.find((row) => row.id === credit.paymentId)
    const proposal = credit.paymentId === paymentId ? payment : undefined
    return { date: credit.date, mode: proposal?.mode ?? stored?.mode ?? '', reference: proposal?.reference ?? stored?.reference ?? credit.reference ?? '',
      hasNote: hasPurchasePaymentNote(proposal?.note ?? stored?.privateNote),
      creditLabel: proposal ? undefined : purchaseChittyCreditLabel(stored?.kind, credit.reference, Boolean(stored)),
      amountPaise: credit.amountPaise, pinned: credit.pinned }
  })
  const preview: BillChittyData = {
    inNo: input.inNo, date: p.date, supplierName: match.name, pool: p.pool, taxMode: p.tax_mode, gstRateBp,
    supplierBillNo: input.supplierBillNo, vehicleNo: p.vehicle_no, bagsAtReceiptKg: parseBagsAtReceiptKg(input.privateNote),
    lines: lines.map((line) => ({ ...line, bardanText: purchaseReceiptMemoText(line.receiptMemo ?? '') || undefined })), bardan, adjustments, paidRows,
    advancePaise: payment ? payment.amountPaise - (simulated.payments.find((row) => row.paymentId === paymentId)?.appliedPaise ?? 0) : undefined,
  }
  return evidence('purchase-bill', d.raw_text, { party: match.name, date: formatFullDate(p.date), amount: formatPaiseInr(net.netPaise) },
    input, () => createPurchaseBill(input), preview)
}
