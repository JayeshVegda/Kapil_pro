import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import { parseCastingSessionDraft, matchCastingMaterial } from '@/domain/casting-session-draft'
import { calculateCastingCost } from '@/domain/casting-calculations'
import type { CastingMaterialRecord } from '@/domain/casting-types'
import { calculateDraftLinePaise, matchPurchaseMaster, parsePurchaseBillDraft } from '@/domain/purchase-bill-draft'
import { parsePurchasePaymentDraft } from '@/domain/purchase-payment-draft'
import { openingBalanceFromRupees, prepareMusePurchaseAction, purchaseBusinessDate } from '@/domain/muse-purchase-actions'
import { computeBillNet } from '@/domain/supplier-purchases'
import { bundleToSettlementInput } from '@/domain/supplier-bundle'
import { computeSupplierSettlement, previewSupplierPayment } from '@/domain/supplier-settlement'
import { mapSupplier } from '@/data/purchase-record-mappers'
import { remainingPurchaseBags, purchaseReceiptBagCount } from '@/domain/purchase-receipt-memos'
import { validateSupplierPaymentMode } from '@/domain/supplier-payment-modes'
import {
  indiaDate, masterLookup, pageMasters, MusePurchaseError, publicBill, purchaseActivity, purchaseDues, readMusePurchaseLedger,
  supplierChoices, type MusePurchaseLedger,
} from './muse-purchase-ledger'
import { parseSalesRequest, prepareSalesProposal, readMuseSalesLedger, salesAsOf, salesCustomer, salesCustomerChoices, salesDues, salesItem, type MuseSalesLedger, type SalesProposalKind } from './muse-sales'

const deploymentVersion = 1
const pbApi = 'http://127.0.0.1:8090/api'
const pbBase = pbApi + '/collections'
const bodyLimit = 48_000
const draftCollections = {
  bill: 'purchase_bill_drafts',
  payment: 'purchase_payment_drafts',
  action: 'muse_purchase_action_drafts',
  casting: 'casting_session_drafts',
} as const
type DraftKind = keyof typeof draftCollections
type RecordOutcome = { id: string; status: string; rejection_reason?: string; converted_record?: string; converted_bill?: string; converted_payment?: string; converted_session?: string }
type DraftRecord = RecordOutcome & { payload: unknown; raw_text: string; supplier_draft?: string }
const sourceIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_./-]+$/)
const draftCursor = z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/), z.string().regex(/^[a-z0-9]{15}$/), z.enum(['bill', 'payment', 'action'])])
type GatewayDraftKind = 'bill' | 'payment' | 'action'

function publicDraftOutcome(row: RecordOutcome, path?: string) {
  const recordId = row.status === 'approved' ? row.converted_bill || row.converted_payment || row.converted_session || row.converted_record : undefined
  return { draftId: row.id, status: row.status, ...(row.status === 'rejected' && row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
    ...(recordId ? { recordId, ...(path ? { kapilPath: path } : {}) } : {}) }
}
type ListRow = { id: string; created: string; status: string; supplier_draft?: string; source_message_id?: string; muse_source_id?: string;
  customer_name?: string; date?: string; bill_total?: number; amount?: number; muse_new_customer?: boolean; payload?: unknown }

function describePurchaseDraft(kind: GatewayDraftKind, payload: unknown) {
  try {
    if (kind === 'payment') {
      const parsed = parsePurchasePaymentDraft(1, payload)
      if (parsed.kind === 'valid') return { party: parsed.value.supplier_name, date: parsed.value.date, amountPaise: parsed.amountPaise }
    } else {
      const parsed = kind === 'bill' ? parsePurchaseBillDraft(2, payload) : null
      const action = kind === 'action' ? prepareMusePurchaseAction(payload) : null
      if (action?.kind === 'bardan') return { action: 'bardan', billId: action.billId, date: action.date, amountPaise: action.creditPaise }
      if (action?.kind === 'opening_balance') return { action: action.kind, party: action.supplierName, supplierId: action.supplierId, date: action.date, kachaPaise: action.kachaPaise, gstPaise: action.gstPaise }
      const bill = action?.kind === 'new_supplier_bill' ? action.bill : parsed?.kind === 'valid' ? parsed.value : null
      if (bill) {
        const net = computeBillNet(bill.lines.map((line) => ({ amountPaise: calculateDraftLinePaise(line.weight_g, line.rate_milli) })),
          (bill.adjustments ?? []).map((row) => ({ type: row.type, amountPaise: row.amount_paise })),
          (bill.bardan ?? []).map((row) => ({ method: row.method, creditPaise: row.credit_paise ?? (row.method === 'deduct' ? calculateDraftLinePaise(row.bardan_g, row.rate_milli) : 0), cashAmountPaise: row.cash_amount_paise ?? 0 })),
          bill.tax_mode, bill.gst_rate_bp ?? (bill.pool === 'gst' ? 1800 : 0))
        return { ...(action ? { action: 'new_supplier_bill' } : {}), party: bill.supplier_name, date: bill.date, amountPaise: net.netPaise }
      }
    }
  } catch { /* Show invalid drafts without exposing the original payload. */ }
  return { needsCorrection: true }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

export function createDraftWriter(email: string, password: string) {
  let session: { token: string; id: string } | undefined
  let login: Promise<{ token: string; id: string }> | undefined
  const credentials = () => {
    if (session) return Promise.resolve(session)
    return login ??= (async () => {
      const res = await fetch(pbBase + '/users/auth-with-password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity: email, password }), signal: AbortSignal.timeout(7000),
      })
      if (!res.ok) throw new MusePurchaseError(503, 'WRITER_LOGIN_FAILED', 'The PC connector could not sign in with its local Muse account.')
      const body = await res.json() as { token?: string; record?: { role?: string; id?: string } }
      if (!body.token || body.record?.role !== 'muse' || !/^[a-z0-9]{15}$/.test(body.record.id ?? '')) throw new MusePurchaseError(503, 'WRITER_ROLE_INVALID', 'The connector must use a normal account with the Muse role.')
      if (!body.record.id) throw new Error('Account ID missing.')
      return session = { token: body.token, id: body.record.id }
    })().finally(() => { login = undefined })
  }
  const request = async (target: string, init: RequestInit = {}, root = pbBase) => {
    const first = await credentials()
    const call = (token: string) => fetch(root + target, {
      ...init, headers: { 'content-type': 'application/json', authorization: token }, signal: AbortSignal.timeout(8000),
    })
    const res = await call(first.token)
    if (res.status !== 401) return res
    if (session?.token === first.token) session = undefined
    return call((await credentials()).token)
  }
  async function findDraft(kind: DraftKind, source: string) {
    const owner = (await credentials()).id
    const collection = '/' + draftCollections[kind] + '/records'
    const search = new URLSearchParams({ filter: 'created_by = "' + owner + '" && source_message_id = "' + source + '"', perPage: '1' })
    const res = await request(collection + '?' + search)
    if (!res.ok) throw new MusePurchaseError(503, 'DRAFT_COLLECTION_UNAVAILABLE', 'The draft collection is not available to the connector. Check the Windows deployment and pending migrations.')
    return { owner, collection, record: ((await res.json()) as { items: DraftRecord[] }).items[0] as DraftRecord | undefined }
  }
  const write = async (kind: DraftKind, source: string, raw: string, payload: unknown, supplierDraftId?: string) => {
    const { owner, collection, record: prior } = await findDraft(kind, source)
    const existing = (record: DraftRecord) => {
      if (stable(record.payload) !== stable(payload) || record.raw_text !== raw || (record.supplier_draft || '') !== (supplierDraftId || '')) throw new MusePurchaseError(409, 'SOURCE_ALREADY_USED', 'This source ID is already linked to a different proposal. Do not create another draft for the same message.')
      return { draftId: record.id, status: record.status, reused: true }
    }
    if (prior) return existing(prior)
    let res: Response | undefined
    try {
      res = await request(collection, { method: 'POST', body: JSON.stringify({
        status: 'pending_review', created_by: owner, source_message_id: source, raw_text: raw, payload,
        ...(supplierDraftId ? { supplier_draft: supplierDraftId } : {}),
        ...(kind === 'action' ? {} : { schema_version: kind === 'bill' ? 2 : 1 }),
      }) })
    } catch (error) {
      if (error instanceof MusePurchaseError) throw error
    }
    const { record: saved } = await findDraft(kind, source)
    if (saved) return { ...existing(saved), reused: res?.ok !== true }
    throw new MusePurchaseError(503, 'DRAFT_NOT_CONFIRMED', 'Draft not confirmed. Retry with the same source ID.')
  }
  async function findSales(kind: SalesProposalKind, source: string) {
    const collection = kind === 'payment' ? 'payment_drafts' : 'bill_drafts'
    const owner = (await credentials()).id
    const search = new URLSearchParams({ filter: 'created_by = "' + owner + '" && muse_source_id = "' + source + '"', perPage: '1',
      fields: 'id,status,muse_request_hash,rejection_reason,' + (kind === 'payment' ? 'converted_payment' : 'converted_bill'), skipTotal: 'true' })
    const response = await request('/' + collection + '/records?' + search)
    if (!response.ok) throw new MusePurchaseError(503, 'SALES_DRAFT_STORAGE_UNAVAILABLE', 'Sales draft storage is not ready. Check the new Sales migration and the local draft account.')
    const data = await response.json() as { items: (RecordOutcome & { muse_request_hash: string })[] }
    return { owner, collection, record: data.items[0] }
  }
  const sales = {
    async status(kind: SalesProposalKind, source: string) {
      const { record } = await findSales(kind, source)
      const converted = record?.converted_bill || record?.converted_payment
      return record ? publicDraftOutcome(record, converted ? `/transactions?focusKind=${kind === 'payment' ? 'payment' : 'bill'}&focusId=${encodeURIComponent(converted)}` : undefined) : null
    },
    async write(input: ReturnType<typeof parseSalesRequest>, build: () => ReturnType<typeof prepareSalesProposal>) {
      const hash = createHash('sha256').update(stable(input.kind === 'new-customer-bill' ? [input.kind, input.originalMessage, input.payload] : [input.originalMessage, input.payload])).digest('hex')
      const existing = (row: NonNullable<Awaited<ReturnType<typeof findSales>>['record']>) => {
        if (row.muse_request_hash !== hash) throw new MusePurchaseError(409, 'SOURCE_ALREADY_USED', 'This Sales source ID is already tied to a different request. Review or reject the original draft.')
        return { draftId: row.id, status: row.status, reused: true }
      }
      const { owner, collection, record } = await findSales(input.kind, input.sourceId)
      if (record) return existing(record)
      const proposal = build()
      const id = randomBytes(8).toString('hex').slice(0, 15)
      const header = { ...proposal.header, id, created_by: owner, status: 'pending_review', muse_source_id: input.sourceId, muse_request_hash: hash }
      let response: Response | undefined
      try {
        response = await request('/batch', { method: 'POST', body: JSON.stringify({ requests: [
          { method: 'POST', url: '/api/collections/' + collection + '/records', body: header },
          ...proposal.items.map((body) => ({ method: 'POST', url: '/api/collections/bill_draft_items/records', body: { ...body, draft: id } })),
          ...proposal.payments.map((body) => ({ method: 'POST', url: '/api/collections/bill_draft_payments/records', body: { ...body, draft: id } })),
        ] }) }, pbApi)
      } catch (error) {
        if (error instanceof MusePurchaseError) throw error
      }
      const { record: saved } = await findSales(input.kind, input.sourceId)
      if (saved) return saved.id === id
        ? { ...existing(saved), reused: false, preview: proposal.preview }
        : existing(saved)
      if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
        throw new MusePurchaseError(422, 'SALES_DRAFT_REJECTED', 'Kapil rejected the draft batch. No Sales record was posted. Check the draft schema, permissions, or batch limit.', { upstreamStatus: response.status })
      }
      throw new MusePurchaseError(503, 'DRAFT_NOT_CONFIRMED', 'The Sales draft could not be confirmed. Check the status using the same source ID before retrying.')
    },
  }
  return Object.assign(write, {
    sales,
    async createParty(module: 'sales' | 'purchase', sourceId: string, name: string) {
      const result = await request('/kapil/muse/create-party', { method: 'POST', body: JSON.stringify({ module, sourceId, name }) }, pbApi)
      if (result.ok || result.status === 409 || result.status === 422) return { status: result.status, body: await result.json() }
      throw new MusePurchaseError(503, 'PARTY_CREATION_UNAVAILABLE', 'Direct party creation is not ready. Check the Windows gateway update and PocketBase hooks.')
    },
    async listDrafts(module: 'purchase' | 'sales', cursor?: z.infer<typeof draftCursor>, filter?: GatewayDraftKind) {
      const owner = (await credentials()).id
      const collections = module === 'purchase'
        ? { bill: draftCollections.bill, payment: draftCollections.payment, action: draftCollections.action }
        : { bill: 'bill_drafts', payment: 'payment_drafts' }
      const pages = await Promise.all((Object.entries(collections) as [GatewayDraftKind, string][]).filter(([kind]) => !filter || filter === kind).map(async ([kind, collection]) => {
        const base = 'created_by = "' + owner + '" && status = "pending_review"'
        const past = cursor ? ' && (created < "' + cursor[0] + '" || (created = "' + cursor[0] + '" && id ' +
          (kind > cursor[2] ? '<=' : '<') + ' "' + cursor[1] + '"))' : ''
        const fields = module === 'purchase' ? 'id,created,status,source_message_id,supplier_draft,payload'
          : 'id,created,status,muse_source_id,customer_name,date,bill_total,amount,muse_new_customer'
        const query = new URLSearchParams({ filter: base + past, sort: '-created,-id', perPage: '26', skipTotal: 'true', fields })
        const response = await request('/' + collection + '/records?' + query)
        if (!response.ok) throw new MusePurchaseError(503, 'DRAFT_COLLECTION_UNAVAILABLE', 'Could not load pending drafts.')
        const { items } = await response.json() as { items: ListRow[] }
        return Promise.all(items.map(async (row) => {
          let waitingForSupplier: boolean | undefined
          let dependencyStatus: string | undefined
          if (row.supplier_draft && /^[a-z0-9]{15}$/.test(row.supplier_draft)) {
            const parent = await request('/muse_purchase_action_drafts/records/' + row.supplier_draft + '?fields=created_by,status,converted_record')
            if (parent.ok) {
              const p = await parent.json() as { created_by: string; status: string; converted_record: string }
              dependencyStatus = p.created_by === owner ? p.status : 'unavailable'
              waitingForSupplier = p.created_by !== owner || p.status !== 'approved' || !p.converted_record
            } else {
              waitingForSupplier = true
              dependencyStatus = 'unavailable'
            }
          }
          return {
            type: kind, draftId: row.id, created: row.created, status: row.status,
            sourceId: row.source_message_id || row.muse_source_id || null,
            ...(module === 'purchase' ? describePurchaseDraft(kind, row.payload) : {
              party: row.customer_name || null, date: row.date?.slice(0, 10), amountRs: kind === 'bill' ? row.bill_total : row.amount,
              ...(row.muse_new_customer ? { action: 'new_customer_bill' } : {}),
            }),
            ...(row.supplier_draft ? { supplierDraftId: row.supplier_draft, waitingForSupplier, dependencyStatus } : {}),
          }
        }))
      }))
      const sorted = pages.flat().sort((a, b) => b.created.localeCompare(a.created) || b.draftId.localeCompare(a.draftId) || a.type.localeCompare(b.type))
      const entries = sorted.slice(0, 25)
      const last = entries.at(-1)
      return { entries, nextCursor: sorted.length > 25 && last ? Buffer.from(JSON.stringify([last.created, last.draftId, last.type])).toString('base64url') : null }
    },
    async supplierDependency(id: string) {
      const owner = (await credentials()).id
      const response = await request('/muse_purchase_action_drafts/records/' + id)
      if (response.status === 404) throw new MusePurchaseError(404, 'SUPPLIER_DRAFT_NOT_FOUND', 'That supplier proposal is not available.')
      if (!response.ok) throw new MusePurchaseError(503, 'DRAFT_COLLECTION_UNAVAILABLE', 'Could not read the supplier proposal.')
      const row = await response.json() as DraftRecord & { created_by: string; converted_record: string }
      if (row.created_by !== owner) throw new MusePurchaseError(404, 'SUPPLIER_DRAFT_NOT_FOUND', 'That supplier proposal is not available.')
      const action = prepareMusePurchaseAction(row.payload)
      if (action.kind !== 'new_supplier_bill' || row.status === 'rejected') inputError('Link a pending or approved new-supplier bill draft, not a rejected or unrelated draft.')
      return { id: row.id, name: action.bill.supplier_name, approved: row.status === 'approved' && Boolean(row.converted_record) }
    },
    status: async (kind: DraftKind, source: string) => {
      const { record } = await findDraft(kind, source)
      if (!record) return null
      const info = kind === 'action' ? describePurchaseDraft(kind, record.payload) : null
      const payload = record.payload as { billId?: unknown } | null
      const path = info?.action === 'opening_balance' && record.converted_record
        ? '/ledger?tab=suppliers&supplierId=' + encodeURIComponent(record.converted_record)
        : kind === 'casting' && record.converted_session
          ? `/casting/log?sessionId=${encodeURIComponent(record.converted_session)}&action=view` : undefined
      return { ...publicDraftOutcome(record, path), ...(record.status === 'approved' && info?.action === 'bardan' && typeof payload?.billId === 'string' ? { billId: payload.billId } : {}) }
    },
  })
}

function inputError(message: string, details?: unknown): never {
  throw new MusePurchaseError(422, 'CHECK_PROPOSAL', message, details)
}

const envelopeSchema = z.strictObject({
  sourceId: sourceIdSchema,
  originalMessage: z.string().trim().min(1).max(4000),
  payload: z.record(z.string(), z.unknown()),
  supplierDraftId: z.string().regex(/^[a-z0-9]{15}$/).optional(),
})
const partyCreateSchema = z.strictObject({ sourceId: sourceIdSchema, name: z.string().trim().min(2).max(140) })

export function prepareCastingProposal(payload: unknown, materials: CastingMaterialRecord[]) {
  const parsed = parseCastingSessionDraft(1, payload)
  if (parsed.kind === 'invalid') inputError('Check the Casting session fields.', parsed.issues)
  const batches = parsed.batches.map((batch) => {
    if (!(batch.wireOut > 0) || !batch.inputs.length || batch.inputs.some((item) => !(item.qty > 0 && item.rate > 0))) inputError('Every batch needs valid positive material input, rate and wire out.')
    const inputs = batch.inputs.map((item) => {
      const material = matchCastingMaterial(item.materialName, item.materialId, materials)
      if (!material || !material.isActive) inputError('Casting material did not match an active record: ' + item.materialName)
      return { ...item, materialId: material.id, materialName: material.name }
    })
    return { ...batch, inputs }
  })
  const clean = { ...parsed.value, batches: parsed.value.batches.map((batch, i) => ({
    ...batch, inputs: batch.inputs.map((item, j) => ({
      ...item, material_id: batches[i].inputs[j].materialId, material_name: batches[i].inputs[j].materialName,
    })),
  })) }
  return { payload: clean, preview: { date: parsed.value.date,
    ...calculateCastingCost({ batches, coalKg: parsed.coalKg, coalRate: parsed.coalRate, workerSalary: parsed.workerSalary }),
  } }
}

function withPendingSupplier(ledger: MusePurchaseLedger, dependency: { id: string; name: string; approved: boolean }) {
  if (dependency.approved) {
    if (!ledger.suppliers.some((row) => row.id === dependency.id && row.active)) inputError('The approved supplier is unavailable or inactive.')
    return ledger
  }
  if (ledger.suppliers.some((row) => row.id === dependency.id)) inputError('Supplier status changed. Refresh the proposal before staging.')
  const supplier = mapSupplier({ id: dependency.id, company_name: dependency.name, active: true })
  const bundle = { supplier, bills: [], lines: [], adjustments: [], bardan: [], payments: [], allocations: [] }
  return { ...ledger, suppliers: [...ledger.suppliers, supplier],
    supplierContexts: new Map(ledger.supplierContexts).set(supplier.id, { bundle, settlement: computeSupplierSettlement(bundleToSettlementInput(bundle)) }) }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inputError('Expected an object.')
  return value as Record<string, unknown>
}

function canonicalBill(input: Record<string, unknown>, ledger: MusePurchaseLedger, isNew: boolean) {
  if (input.pool !== 'kacha' && input.pool !== 'gst') inputError('Confirm the Kacha or GST pool.')
  if (input.pool === 'gst' && input.tax_mode !== 'gst' && input.tax_mode !== 'rcm') inputError('Confirm charged GST or RCM.')
  const supplierName = typeof input.supplier_name === 'string' ? input.supplier_name.trim() : ''
  if (!supplierName) inputError('Supplier name is required.')
  const choices = supplierChoices(ledger)
  const supplier = isNew ? null : masterLookup(supplierName, choices)
  if (isNew && choices.some((choice) => matchPurchaseMaster(supplierName, undefined, [{ ...choice, active: true }]))) inputError('A supplier with this name or alias already exists. Use a normal bill draft or resolve the duplicate.')
  if (input.supplier_id && (!supplier || input.supplier_id !== supplier.id)) inputError('Supplier ID and name do not match.')
  if (!Array.isArray(input.lines)) inputError('Provide purchase item lines.')
  const payload = {
    ...input, supplier_name: supplier?.name ?? supplierName, ...(supplier ? { supplier_id: supplier.id } : {}),
    date: input.date ?? indiaDate(),
    ...(input.pool === 'gst' ? { gst_rate_bp: input.gst_rate_bp ?? 1800 } : {}),
    lines: input.lines.map((line) => {
      const data = asObject(line)
      const item = masterLookup(typeof data.item_name === 'string' ? data.item_name : '', ledger.items)
      if (data.item_id && data.item_id !== item.id) inputError('Item ID and name do not match.')
      return { ...data, item_id: item.id, item_name: item.name }
    }),
  }
  const parsed = parsePurchaseBillDraft(2, payload)
  if (parsed.kind === 'invalid') inputError('The bill did not pass validation.', parsed.issues)
  const bill = parsed.value
  const wrongLine = bill.lines.findIndex((line) => line.amount_paise !== calculateDraftLinePaise(line.weight_g, line.rate_milli))
  if (wrongLine >= 0) inputError(`Amount on line ${wrongLine + 1} does not match quantity × rate. Correct it or provide only quantity and rate.`)
  const net = computeBillNet(
    bill.lines.map((line) => ({ amountPaise: line.amount_paise })),
    (bill.adjustments ?? []).map((row) => ({ type: row.type, amountPaise: row.amount_paise })),
    (bill.bardan ?? []).map((row) => ({
      method: row.method,
      creditPaise: row.credit_paise ?? (row.method === 'deduct' ? calculateDraftLinePaise(row.bardan_g, row.rate_milli) : 0),
      cashAmountPaise: row.cash_amount_paise ?? 0,
    })),
    bill.tax_mode, bill.gst_rate_bp ?? 0,
  )
  return { payload, preview: {
    supplier: bill.supplier_name, date: bill.date, pool: bill.pool, taxMode: bill.tax_mode,
    netPaise: net.netPaise, gstRateBp: bill.gst_rate_bp ?? 0, taxPaise: net.taxPaise,
    paidPaise: bill.payment?.amount_paise ?? 0,
    ...(bill.stated_total_paise === undefined ? {} : { statedTotalDifferencePaise: bill.stated_total_paise - net.netPaise }),
  } }
}

export function prepareApiProposal(kind: string, value: unknown, ledger: MusePurchaseLedger) {
  const body = envelopeSchema.parse(value)
  const p = body.payload
  if (kind === 'opening-balance') {
    const request = z.strictObject({
      supplier: z.string().trim().min(1).max(150), date: purchaseBusinessDate,
      kacha_rs: z.string().max(24).optional(), gst_rs: z.string().max(24).optional(),
    }).parse(p)
    const supplier = masterLookup(request.supplier, supplierChoices(ledger))
    let values
    try { values = openingBalanceFromRupees(request.date, request.kacha_rs, request.gst_rs) }
    catch (err) { inputError(err instanceof Error ? err.message : 'Invalid signed opening balance.') }
    if (values.date > indiaDate()) inputError('Opening balance date cannot be in the future.')
    const payload = { kind: 'opening_balance' as const, supplierId: supplier.id, supplierName: supplier.name, ...values }
    const bundle = ledger.supplierContexts.get(supplier.id)?.bundle
    const canApprove = Boolean(bundle && !bundle.supplier.openingBalanceDate && !bundle.supplier.openingKachaPaise && !bundle.supplier.openingGstPaise && !bundle.bills.length && !bundle.payments.length)
    return { ...body, kind: 'action' as const, payload, preview: { supplier: supplier.name, supplierId: supplier.id, ...values, canApprove,
      ...(!canApprove ? { warning: 'This supplier already has an opening balance or activity. Review it manually in Kapil.' } : {}) } }
  }
  if (kind === 'bill' || kind === 'new-supplier-bill') {
    const bill = canonicalBill(p, ledger, kind === 'new-supplier-bill')
    if (kind === 'bill') return { ...body, kind: 'bill' as const, ...bill }
    const payload = { kind: 'new_supplier_bill', bill: bill.payload }
    prepareMusePurchaseAction(payload)
    return { ...body, kind: 'action' as const, payload, preview: { ...bill.preview, newSupplier: true } }
  }
  if (kind === 'payment') {
    if (p.pool !== 'kacha' && p.pool !== 'gst') inputError('Confirm the Kacha or GST pool.')
    if (!p.kind || !p.mode) inputError('Confirm payment direction/type and payment mode.')
    if (p.bill_pins) inputError('Leave payment on account. The owner can allocate it during review.')
    const supplier = masterLookup(typeof p.supplier_name === 'string' ? p.supplier_name : '', supplierChoices(ledger))
    if (p.supplier_id && p.supplier_id !== supplier.id) inputError('Supplier ID and name do not match.')
    const payload = { ...p, supplier_id: supplier.id, supplier_name: supplier.name, date: p.date ?? indiaDate() }
    const parsed = parsePurchasePaymentDraft(1, payload)
    if (parsed.kind === 'invalid') inputError('The payment did not pass validation.', parsed.issues)
    try { validateSupplierPaymentMode(parsed.value.mode ?? '', parsed.value.reference) }
    catch (error) { inputError(error instanceof Error ? error.message : 'Check the payment mode and reference.') }
    const { pool, date, kind: paymentKind } = parsed.value
    const supplierBundle = ledger.supplierContexts.get(supplier.id)?.bundle
    if (!supplierBundle) inputError('Supplier ledger is unavailable.')
    const { before, after } = previewSupplierPayment(bundleToSettlementInput(supplierBundle), {
      pool, date, kind: paymentKind, amountPaise: parsed.amountPaise, pinnedBillIds: [],
    })
    return { ...body, kind: 'payment' as const, payload, preview: {
      supplier: supplier.name, pool, date, kind: paymentKind, amountPaise: parsed.amountPaise,
      before: { duePaise: before.pools[pool].outstandingPaise, advancePaise: before.pools[pool].advancePaise },
      after: { duePaise: after.pools[pool].outstandingPaise, advancePaise: after.pools[pool].advancePaise },
    } }
  }
  if (kind === 'bardan') {
    if (p.method !== 'deduct' && p.method !== 'in_kind') inputError('Confirm deduct from the bill or settle in kind.')
    const bill = ledger.bills.find((row) => !row.cancelled && (row.id === p.billId || row.inNo === p.inNo))
    if (!bill) inputError('Find a non-voided purchase slip before proposing bardan.')
    const line = p.lineId ? bill.lines.find((entry) => entry.id === p.lineId) : bill.lines.length === 1 ? bill.lines[0] : undefined
    if (!line) inputError('Select the slip material line.', publicBill(bill).lines)
    const recorded = purchaseReceiptBagCount(line.receiptMemo)
    if ((recorded > 0 && Number(p.bagCount) > remainingPurchaseBags(line, bill.bardan)) || (!recorded && bill.bardan.length > 0)) {
      inputError('The proposed bag count cannot be reconciled with this slip. Review the existing receipt and settlements.')
    }
    const payload = { kind: 'bardan', billId: bill.id, lineId: line.id, bagCount: p.bagCount, weightG: p.weightG,
      rateMilli: line.rateMilli, method: p.method, date: p.date ?? indiaDate() }
    const action = prepareMusePurchaseAction(payload)
    if (action.kind !== 'bardan') inputError('Expected a bardan action.')
    return { ...body, kind: 'action' as const, payload, preview: {
      inNo: bill.inNo, supplier: bill.supplierName, item: line.itemName, billNetPaise: bill.netPaise,
      ...action,
    } }
  }
  throw new MusePurchaseError(404, 'UNKNOWN_OPERATION', 'Unknown purchase proposal type.')
}

async function readJson(req: IncomingMessage) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new MusePurchaseError(415, 'JSON_REQUIRED', 'Use application/json.')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const data of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.from(data)
    bytes += chunk.length
    if (bytes > bodyLimit) { req.resume(); throw new MusePurchaseError(413, 'BODY_TOO_LARGE', 'Proposal is too large.') }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new MusePurchaseError(400, 'INVALID_JSON', 'The request body is not valid JSON.') }
}

export function createMusePurchaseServer(config: {
  keyDigest: Buffer
  loadLedger: (asOf: string) => MusePurchaseLedger
  loadSales?: () => MuseSalesLedger
  loadCasting?: () => { enabled: boolean; materials: CastingMaterialRecord[] }
  writeDraft?: ((kind: DraftKind, source: string, raw: string, payload: unknown, supplierDraftId?: string) => Promise<{ draftId: string; status: string; reused: boolean }>)
    & Pick<ReturnType<typeof createDraftWriter>, 'status'> & Partial<Pick<ReturnType<typeof createDraftWriter>, 'sales' | 'supplierDependency' | 'listDrafts' | 'createParty'>>
}) {
  let active = 0, windowStart = 0, count = 0
  return createServer({ requestTimeout: 15_000, headersTimeout: 8000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)) }
    const key = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1] ?? req.headers['x-api-key']
    if (typeof key !== 'string' || !timingSafeEqual(createHash('sha256').update(key).digest(), config.keyDigest)) {
      req.resume()
      res.setHeader('connection', 'close')
      return reply(401, { error: 'API_KEY_REQUIRED', message: 'Use the configured Kapil Muse API key.' })
    }
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); count = 0 }
    if (++count > 90 || active >= 6) { req.resume(); return reply(429, { error: 'TRY_LATER' }) }
    active++
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = url.pathname.startsWith('/v1/purchase/') ? '/v1/' + url.pathname.slice('/v1/purchase/'.length) : url.pathname
      if (req.method === 'GET' && ['/v1/drafts', '/v1/sales/drafts'].includes(route)) {
        const sales = route.startsWith('/v1/sales/')
        if (sales && !config.loadSales) return reply(404, { error: 'MODULE_UNAVAILABLE' })
        if (!sales) config.loadLedger(indiaDate())
        if (!config.writeDraft?.listDrafts) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'A configured writer is required to list your pending drafts.')
        const cursor = url.searchParams.get('cursor')
        let parsedCursor: z.infer<typeof draftCursor> | undefined
        if (cursor) {
          try {
            if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid cursor')
            parsedCursor = draftCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
          } catch { inputError('Use the nextCursor returned by the previous draft list request.') }
        }
        const type = (sales ? z.enum(['bill', 'payment']) : z.enum(['bill', 'payment', 'action'])).optional().parse(url.searchParams.get('type') ?? undefined)
        return reply(200, await config.writeDraft.listDrafts(sales ? 'sales' : 'purchase', parsedCursor, type))
      }
      if (req.method === 'GET' && route === '/v1/modules') return reply(200, { sales: Boolean(config.loadSales), purchase: true, casting: config.loadCasting?.().enabled ?? false, draftsConfigured: Boolean(config.writeDraft) })
      if (req.method === 'POST' && ['/v1/supplier', '/v1/sales/customer'].includes(route)) {
        const module = route.startsWith('/v1/sales') ? 'sales' : 'purchase'
        if (module === 'purchase') config.loadLedger(indiaDate())
        else if (!config.loadSales) return reply(404, { error: 'MODULE_UNAVAILABLE' })
        const body = partyCreateSchema.parse(await readJson(req))
        if (!config.writeDraft?.createParty) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
        const result = await config.writeDraft.createParty(module, body.sourceId, body.name)
        return reply(result.status, result.body)
      }
      if (route.startsWith('/v1/casting/')) {
        const casting = config.loadCasting?.()
        if (!casting) return reply(404, { error: 'MODULE_UNAVAILABLE' })
        if (!casting.enabled) return reply(403, { error: 'CASTING_DISABLED' })
        if (req.method === 'GET' && route === '/v1/casting/materials') return reply(200, pageMasters(casting.materials.map(({ id, name, aliases, isActive }) => ({ id, name, aliases, active: isActive })),
          z.string().max(140).parse(url.searchParams.get('q') ?? ''), z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1)))
        if (req.method === 'GET' && route === '/v1/casting/drafts/status') {
          const sourceId = sourceIdSchema.parse(url.searchParams.get('sourceId'))
          if (!config.writeDraft) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
          const found = await config.writeDraft.status('casting', sourceId)
          return reply(found ? 200 : 404, found ?? { error: 'DRAFT_NOT_FOUND' })
        }
        if (req.method !== 'POST' || !['/v1/casting/preview/session', '/v1/casting/drafts/session'].includes(route)) {
          req.resume(); return reply(404, { error: 'UNKNOWN_OPERATION' })
        }
        const body = envelopeSchema.parse(await readJson(req))
        if (body.supplierDraftId) inputError('supplierDraftId is only for Purchase.')
        const castingProposal = prepareCastingProposal(body.payload, casting.materials)
        if (route.includes('/preview/')) return reply(200, { status: 'preview_only', preview: castingProposal.preview })
        if (!config.writeDraft) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
        const draft = await config.writeDraft('casting', body.sourceId, body.originalMessage, castingProposal.payload)
        return reply(draft.reused ? 200 : 201, { ...draft, preview: castingProposal.preview, posted: false })
      }
      if (route.startsWith('/v1/sales/')) {
        if (!config.loadSales) return reply(404, { error: 'MODULE_UNAVAILABLE' })
        const endpoint = route.slice('/v1/sales/'.length)
        if (req.method === 'GET') {
          if (endpoint === 'health') {
            config.loadSales()
            return reply(200, { status: 'ready', version: deploymentVersion, draftsConfigured: Boolean(config.writeDraft?.sales) })
          }
          if (endpoint === 'drafts/status') {
            if (!config.writeDraft?.sales) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
            const kind = z.enum(['bill', 'payment', 'new-customer-bill']).parse(url.searchParams.get('type'))
            const sourceId = sourceIdSchema.parse(url.searchParams.get('sourceId'))
            const status = await config.writeDraft.sales.status(kind, sourceId)
            return reply(status ? 200 : 404, status ?? { error: 'DRAFT_NOT_FOUND' })
          }
          if (!['dues', 'customer', 'customers', 'item'].includes(endpoint)) return reply(404, { error: 'UNKNOWN_OPERATION' })
          const query = z.string().trim().max(150).parse(url.searchParams.get('customer') ?? '')
          const ledger = config.loadSales()
          if (endpoint === 'dues') return reply(200, salesDues(ledger, salesAsOf(url.searchParams.get('asOf')), query || undefined))
          if (endpoint === 'customers') return reply(200, pageMasters(salesCustomerChoices(ledger), z.string().trim().max(150).parse(url.searchParams.get('q') ?? ''),
            z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1), url.searchParams.get('includeInactive') === 'true'))
          if (endpoint === 'customer') {
            const { id, name, active } = salesCustomer(ledger, query, true)
            return reply(200, { id, name, active })
          }
          const { id, name, type, unit, bagWeight } = salesItem(ledger, z.string().trim().max(150).parse(url.searchParams.get('name') ?? ''))
          return reply(200, { id, name, type, unit, bagWeight })
        }
        const action = /^(preview|drafts)\/(bill|payment|new-customer-bill)$/.exec(endpoint)
        if (req.method !== 'POST' || !action) { req.resume(); return reply(404, { error: 'UNKNOWN_OPERATION' }) }
        const request = parseSalesRequest(action[2] as SalesProposalKind, await readJson(req))
        const build = () => prepareSalesProposal(request, config.loadSales!())
        const previewToken = (preview: unknown) => createHash('sha256').update(stable(preview)).digest('hex')
        if (action[1] === 'preview') {
          const { preview } = build()
          return reply(200, { status: 'preview_only', preview, previewToken: previewToken(preview) })
        }
        if (!config.writeDraft?.sales) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
        const saved = await config.writeDraft.sales.write(request, () => {
          const proposal = build()
          const currentToken = previewToken(proposal.preview)
          if (request.previewToken && request.previewToken !== currentToken) {
            throw new MusePurchaseError(409, 'PREVIEW_CHANGED', 'Sales pricing or balance changed. Review the fresh preview before staging.', {
              preview: proposal.preview, previewToken: currentToken,
            })
          }
          return proposal
        })
        return reply(saved.reused ? 200 : 201, { ...saved, posted: false })
      }
      if (req.method === 'GET' && route === '/v1/health') {
        config.loadLedger(indiaDate())
        return reply(200, { status: 'ready', version: deploymentVersion, draftsConfigured: Boolean(config.writeDraft) })
      }
      if (req.method === 'GET' && route === '/v1/drafts/status') {
        const type = z.enum(['bill', 'payment', 'action']).parse(url.searchParams.get('type'))
        const sourceId = sourceIdSchema.parse(url.searchParams.get('sourceId'))
        if (!config.writeDraft) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
        const status = await config.writeDraft.status(type, sourceId)
        if (!status) return reply(404, { error: 'DRAFT_NOT_FOUND' })
        if (status.status === 'approved' && status.recordId && !status.kapilPath) {
          const ledger = config.loadLedger('9999-12-31')
          const bill = type === 'bill' || type === 'action' ? ledger.bills.find((b) => b.id === (status.billId ?? status.recordId)) : undefined
          const payment = type === 'payment' ? ledger.payments.find((p) => p.id === status.recordId) : undefined
          const path = bill ? '/purchase-bills/' + encodeURIComponent(bill.inNo)
            : payment ? '/ledger?tab=suppliers&supplierSection=payments&supplierId=' + encodeURIComponent(payment.supplierId) : undefined
          const { billId: _, ...publicStatus } = status
          return reply(200, { ...publicStatus, ...(path ? { kapilPath: path } : {}) })
        }
        return reply(200, status)
      }
      if (req.method !== 'GET' && !(req.method === 'POST' && /^\/v1\/(?:preview|drafts)\/(?:bill|payment|bardan|new-supplier-bill|opening-balance)$/.test(route))) {
        req.resume(); return reply(404, { error: 'UNKNOWN_OPERATION' })
      }
      if (req.method === 'GET' && !['/v1/supplier', '/v1/suppliers', '/v1/item', '/v1/dues', '/v1/recent-payment', '/v1/slips', '/v1/activity'].includes(route)) return reply(404, { error: 'UNKNOWN_OPERATION' })
      const asOf = purchaseBusinessDate.parse(req.method === 'POST' ? indiaDate() : url.searchParams.get('asOf') ?? indiaDate())
      if (asOf > indiaDate()) inputError('As-of date cannot be in the future.')
      const ledger = config.loadLedger(asOf)
      const term = url.searchParams.get('supplier')?.trim()
      if (term && term.length > 140) inputError('Supplier lookup is too long.')
      const supplier = () => term ? masterLookup(term, supplierChoices(ledger), true) : undefined
      if (req.method === 'GET') {
        switch (route) {
          case '/v1/supplier': return reply(200, masterLookup(term ?? '', supplierChoices(ledger), true))
          case '/v1/suppliers': return reply(200, pageMasters(supplierChoices(ledger), z.string().trim().max(150).parse(url.searchParams.get('q') ?? ''),
            z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1), url.searchParams.get('includeInactive') === 'true'))
          case '/v1/item': return reply(200, masterLookup(url.searchParams.get('name')?.trim() ?? '', ledger.items))
          case '/v1/dues': return reply(200, purchaseDues(ledger, supplier(), url.searchParams.get('include') === 'suppliers'))
          case '/v1/activity': return reply(200, purchaseActivity(ledger,
            z.coerce.number().int().min(1).max(90).parse(url.searchParams.get('days') ?? 7),
            z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1), supplier()))
          case '/v1/recent-payment': {
            const owner = supplier()
            const payment = ledger.payments.find((row) => !row.cancelled && (row.kind === 'payment' || row.kind === 'paid_on_behalf') && (!owner || row.supplierId === owner.id))
            return reply(200, { asOf, payment: payment ? {
              supplier: payment.supplierName, pool: payment.pool, date: payment.date, kind: payment.kind, amountPaise: payment.amountPaise,
              mode: payment.mode, reference: payment.reference,
            } : null })
          }
          case '/v1/slips': {
            const owner = supplier()
            const inNo = url.searchParams.get('inNo')?.trim()
            const invoice = url.searchParams.get('invoice')?.trim()
            const pendingOnly = url.searchParams.get('pending') === 'true'
            if (!owner && !inNo && (!pendingOnly || invoice)) inputError('Give a supplier or inward bill number, or use pending=true for all open slips.')
            const page = z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1)
            const list = ledger.bills.filter((row) => !row.cancelled && (!owner || row.supplierId === owner.id) &&
              (!inNo || row.inNo.toLowerCase() === inNo.toLowerCase()) &&
              (!invoice || row.supplierBillNo.toLowerCase() === invoice.toLowerCase()) && (!pendingOnly || row.duePaise > 0))
            const groups = new Map<string, { id: string; name: string; duePaise: number; kachaDuePaise: number; gstDuePaise: number; slipCount: number }>()
            for (const row of list) {
              const group = groups.get(row.supplierId) ?? { id: row.supplierId, name: row.supplierName, duePaise: 0, kachaDuePaise: 0, gstDuePaise: 0, slipCount: 0 }
              group.duePaise += row.duePaise
              group[row.pool === 'kacha' ? 'kachaDuePaise' : 'gstDuePaise'] += row.duePaise
              group.slipCount++
              groups.set(row.supplierId, group)
            }
            return reply(200, { asOf, page, pageSize: 25, total: list.length, totalDuePaise: list.reduce((sum, row) => sum + row.duePaise, 0),
              suppliers: [...groups.values()].sort((a, b) => b.duePaise - a.duePaise || a.id.localeCompare(b.id)),
              ...(owner ? { supplierDues: purchaseDues(ledger, owner) } : {}),
              slips: list.slice((page - 1) * 25, page * 25).map(publicBill),
            })
          }
          default: return reply(404, { error: 'UNKNOWN_OPERATION' })
        }
      }
      const operation = route.split('/').at(-1) ?? ''
      const body = envelopeSchema.parse(await readJson(req))
      const dependency = body.supplierDraftId ? await (async () => {
        if (operation !== 'bill' && operation !== 'payment') inputError('supplierDraftId is only for follow-up bills and payments.')
        if (!config.writeDraft?.supplierDependency) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'A configured writer is required to resolve a linked supplier.')
        return config.writeDraft.supplierDependency(body.supplierDraftId!)
      })() : null
      if (dependency && body.payload.supplier_id && body.payload.supplier_id !== dependency.id) inputError('Supplier ID does not match the linked draft.')
      if (dependency && typeof body.payload.supplier_name === 'string' && body.payload.supplier_name.trim().toLowerCase() !== dependency.name.toLowerCase()) {
        inputError('Supplier name does not match the linked draft.')
      }
      const proposal = prepareApiProposal(operation, dependency ? { ...body, payload: { ...body.payload, supplier_id: dependency.id, supplier_name: dependency.name } } : body,
        dependency ? withPendingSupplier(ledger, dependency) : ledger)
      const link = dependency ? { supplierDraftId: dependency.id, waitingForSupplier: !dependency.approved } : {}
      if (route.startsWith('/v1/preview/')) return reply(200, { status: 'preview_only', preview: proposal.preview, ...link })
      if (!config.writeDraft) throw new MusePurchaseError(503, 'DRAFT_WRITER_NOT_CONFIGURED', 'The Windows connector is in read-only mode.')
      if (operation === 'opening-balance' && 'canApprove' in proposal.preview && !proposal.preview.canApprove &&
        !await config.writeDraft.status('action', proposal.sourceId)) {
        throw new MusePurchaseError(409, 'OPENING_BALANCE_MANUAL_REVIEW', 'This supplier already has an opening balance or activity. Review it manually in Kapil.')
      }
      const saved = dependency
        ? await config.writeDraft(proposal.kind, proposal.sourceId, proposal.originalMessage, proposal.payload, dependency.id)
        : await config.writeDraft(proposal.kind, proposal.sourceId, proposal.originalMessage, proposal.payload)
      return reply(saved.reused ? 200 : 201, { ...saved, preview: proposal.preview, ...link, posted: false })
    } catch (error) {
      if (error instanceof MusePurchaseError) return reply(error.status, { error: error.code, message: error.message, details: error.details })
      if (error instanceof z.ZodError) return reply(422, { error: 'CHECK_INPUT', details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) })
      console.error('[muse-gateway] operation failed', error instanceof Error ? error.name : 'unknown')
      return reply(503, { error: 'MODULE_UNAVAILABLE', message: 'The Kapil connector could not complete the request.' })
    } finally { active-- }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keyFile = path.join(import.meta.dirname, 'muse-purchase.key.sha256')
  const hex = readFileSync(keyFile, 'utf8').trim()
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Run the Windows setup script first.')
  const databasePath = path.resolve(import.meta.dirname, '../data/data.db')
  const email = process.env.KAPIL_MUSE_PURCHASE_EMAIL
  const password = process.env.KAPIL_MUSE_PURCHASE_PASSWORD
  delete process.env.KAPIL_MUSE_PURCHASE_EMAIL
  delete process.env.KAPIL_MUSE_PURCHASE_PASSWORD
  createMusePurchaseServer({
    keyDigest: Buffer.from(hex, 'hex'),
    loadLedger: (date) => readMusePurchaseLedger(databasePath, date),
    loadSales: () => readMuseSalesLedger(databasePath),
    loadCasting: () => {
      const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 1500 })
      try {
        const setting = db.prepare("SELECT casting_enabled FROM app_settings WHERE id = 'globalsettings1'").get()
        if (!setting?.casting_enabled) return { enabled: false, materials: [] }
        const rows = db.prepare('SELECT id, name, aliases, code, category, is_active FROM casting_materials ORDER BY name, id').all()
        return { enabled: true, materials: rows.map((row) => ({
          id: String(row.id), name: String(row.name), aliases: String(row.aliases ?? ''), code: String(row.code ?? ''), category: String(row.category ?? ''), isActive: Boolean(row.is_active),
        })) }
      } finally { db.close() }
    },
    writeDraft: email && password ? createDraftWriter(email, password) : undefined,
  }).listen(4796, '127.0.0.1', () => console.log('[muse-purchase] listening on loopback'))
}
