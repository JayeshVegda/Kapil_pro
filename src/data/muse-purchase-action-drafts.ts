import { pb } from './pocketbase'
import { addPurchaseBardanEntry, createPurchaseBill, listPurchaseItems } from './suppliers'
import { prepareMusePurchaseAction } from '@/domain/muse-purchase-actions'
import { matchPurchaseMaster } from '@/domain/purchase-bill-draft'

const collection = 'muse_purchase_action_drafts'
export const musePurchaseActionsKey = [collection] as const

export type MusePurchaseActionRecord = {
  id: string
  payload: unknown
  raw_text: string
  rejection_reason?: string
  status: string
  created: string
  converted_record: string
}

export async function loadMusePurchaseActions() {
  try {
    return await pb.collection(collection).getFullList<MusePurchaseActionRecord>({ sort: '-created,-id' })
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error && error.status === 404) return []
    throw error
  }
}

export async function loadMusePurchaseAction(id: string) {
  return pb.collection(collection).getOne<MusePurchaseActionRecord>(id)
}

export async function rejectMusePurchaseAction(id: string) {
  await pb.collection(collection).update(id, { status: 'rejected' })
}

export async function approveMusePurchaseAction(record: MusePurchaseActionRecord, inNo = '') {
  const current = await pb.collection(collection).getOne<MusePurchaseActionRecord>(record.id)
  if (current.status !== 'pending_review') throw new Error('This proposal was already processed.')
  if (JSON.stringify(current.payload) !== JSON.stringify(record.payload)) throw new Error('This proposal changed. Close and review it again.')
  const action = prepareMusePurchaseAction(current.payload)
  if (action.kind === 'bardan') {
    await addPurchaseBardanEntry({
      actionDraftId: record.id, billId: action.billId, rateLineId: action.lineId, bagCount: action.bagCount,
      bardanG: action.weightG, rateMilli: action.rateMilli, creditPaise: action.creditPaise, method: action.method, date: action.date,
    })
    return { type: 'bardan' } as const
  }
  const items = await listPurchaseItems()
  const bill = action.bill
  const lines = bill.lines.map((line) => {
    const item = matchPurchaseMaster(line.item_name, line.item_id, items)
    if (!item) throw new Error(`Purchase item “${line.item_name}” is no longer an exact active match.`)
    return { itemId: item.id, itemName: item.name, weightG: line.weight_g, rateMilli: line.rate_milli, amountPaise: line.amount_paise, receiptMemo: line.receipt_memo }
  })
  const saved = await createPurchaseBill({
    newSupplierDraft: { name: bill.supplier_name, actionDraftId: record.id },
    supplierId: record.id, inNo, date: bill.date, pool: bill.pool,
    taxMode: bill.tax_mode, gstRateBp: bill.gst_rate_bp, supplierBillNo: bill.supplier_bill_no,
    lines,
  })
  return { type: 'bill', inNo: saved.inNo } as const
}
