import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9]{15}$/)
const nonnegativeInteger = z.number().int().safe().nonnegative()
const positiveInteger = z.number().int().safe().positive()
const businessDate = z.iso.date()

export type PurchaseMaster = { id: string; name: string; aliases?: string; active?: boolean }
const matchKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function normalizePurchaseAliases(raw: string, primaryName: string): string {
  const seen = new Set([matchKey(primaryName)])
  const aliases = raw.split(/[,\n]/).map((alias) => alias.trim().replace(/\s+/g, ' ')).filter(Boolean).filter((alias) => {
    const key = matchKey(alias)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const result = aliases.join('\n')
  if (result.length > 2000) throw new Error('Aliases are too long')
  return result
}

/** Match only within the supplied master list; ambiguous aliases stay unresolved. */
export function matchPurchaseMaster<T extends PurchaseMaster>(name: string, id: string | undefined, masters: T[]): T | null {
  const matches = masters.filter((master) => master.active !== false &&
    (matchKey(master.name) === matchKey(name) || master.aliases?.split(/[,\n]/).some((alias) => matchKey(alias) === matchKey(name))))
  if (id) return matches.find((master) => master.id === id) ?? null
  return matches.length === 1 ? matches[0] : null
}

/** Parse decimal text with BigInt scaling. No Number/parseFloat before unit conversion. */
export function parsePurchaseDecimal(value: string, decimals: number, label: string): number {
  const trimmed = value.trim()
  if (trimmed.includes(',') && !/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) throw new Error(`${label} has invalid grouping`)
  const clean = trimmed.replace(/,/g, '')
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(clean)
  if (!match) throw new Error(`${label} must be a decimal number`)
  const fraction = match[3] ?? ''
  if (fraction.length > decimals) throw new Error(`${label} allows at most ${decimals} decimal places`)
  const scale = 10n ** BigInt(decimals)
  const units = BigInt(match[2]) * scale + BigInt((fraction || '0').padEnd(decimals, '0'))
  const signed = match[1] ? -units : units
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`${label} is too large`)
  return Number(signed)
}

export function calculateDraftLinePaise(weightG: number, rateMilli: number): number {
  if (!Number.isSafeInteger(weightG) || !Number.isSafeInteger(rateMilli) || weightG < 0 || rateMilli < 0) throw new Error('Invalid purchase line units')
  const numerator = BigInt(weightG) * BigInt(rateMilli)
  const amount = (numerator + 5000n) / 10000n
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Purchase line amount is too large')
  return Number(amount)
}

export const purchaseBillDraftPayloadV1 = z.strictObject({
  supplier_id: id.optional(),
  supplier_name: z.string().trim().min(1),
  date: businessDate,
  supplier_bill_no: z.string().trim().optional(),
  pool: z.enum(['kacha', 'gst']),
  tax_mode: z.enum(['none', 'gst', 'rcm']),
  gst_rate_bp: nonnegativeInteger.optional(),
  vehicle_no: z.string().trim().optional(),
  private_note: z.string().optional(),
  lines: z.array(z.strictObject({
    item_id: id.optional(),
    item_name: z.string().trim().min(1),
    weight_g: positiveInteger,
    rate_milli: nonnegativeInteger,
    amount_paise: nonnegativeInteger,
    receipt_memo: z.string().optional(),
  })).min(1),
  stated_total_paise: nonnegativeInteger.optional(),
  adjustments: z.array(z.strictObject({
    type: z.enum(['labour', 'transport', 'quality_cut', 'other']),
    amount_paise: nonnegativeInteger,
    note: z.string().optional(),
  })).optional(),
  bardan: z.array(z.strictObject({
    bardan_g: positiveInteger,
    rate_line_index: nonnegativeInteger.optional(),
    rate_milli: nonnegativeInteger,
    method: z.enum(['deduct', 'in_kind', 'cash_back', 'advance']),
    credit_paise: nonnegativeInteger.optional(),
    cash_amount_paise: nonnegativeInteger.optional(),
    date: businessDate.optional(),
    note: z.string().optional(),
  })).optional(),
  payment: z.strictObject({
    amount_paise: positiveInteger,
    mode: z.enum(['cash', 'upi', 'rtgs', 'neft', 'cheque', 'other']),
    reference: z.string().optional(),
    note: z.string().optional(),
  }).optional(),
})

export type PurchaseBillDraftPayloadV1 = z.infer<typeof purchaseBillDraftPayloadV1>

// Schema 2 is Muse-facing: human decimal strings only. The editor receives the
// canonical integer shape above. A legacy schema 1 draft remains readable.
const decimal = z.string().min(1)
export const purchaseBillDraftPayloadV2 = z.strictObject({
  supplier_id: id.optional(), supplier_name: z.string().trim().min(1),
  date: businessDate, supplier_bill_no: z.string().trim().optional(),
  pool: z.enum(['kacha', 'gst']).optional(),
  tax_mode: z.enum(['none', 'gst', 'rcm']).optional(),
  gst_rate_bp: nonnegativeInteger.optional(),
  vehicle_no: z.string().trim().optional(), private_note: z.string().optional(),
  stated_total_rs: decimal.optional(),
  lines: z.array(z.strictObject({
    item_id: id.optional(), item_name: z.string().trim().min(1),
    weight_kg: decimal, rate_rs_per_kg: decimal, amount_rs: decimal.optional(),
    receipt_memo: z.string().optional(),
  })).min(1),
  adjustments: z.array(z.strictObject({
    type: z.enum(['labour', 'transport', 'quality_cut', 'other']),
    amount_rs: decimal, note: z.string().optional(),
  })).optional(),
  bardan: z.array(z.strictObject({
    weight_kg: decimal, rate_line_index: nonnegativeInteger.optional(),
    rate_rs_per_kg: decimal, method: z.enum(['deduct', 'in_kind', 'cash_back', 'advance']),
    credit_rs: decimal.optional(), cash_amount_rs: decimal.optional(),
    date: businessDate.optional(), note: z.string().optional(),
  })).optional(),
  payment: z.strictObject({
    amount_rs: decimal, mode: z.enum(['cash', 'upi', 'rtgs', 'neft', 'cheque', 'other']),
    reference: z.string().optional(), note: z.string().optional(),
  }).optional(),
})

function invalid(issues: z.core.$ZodIssue[]): { kind: 'invalid'; issues: string[] } {
  return { kind: 'invalid', issues: issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`) }
}

function validateLineMath(value: PurchaseBillDraftPayloadV1) {
  try {
    for (const line of value.lines) calculateDraftLinePaise(line.weight_g, line.rate_milli)
    return { kind: 'valid' as const, value }
  } catch (error) {
    return { kind: 'invalid' as const, issues: [error instanceof Error ? error.message : 'Invalid line amount'] }
  }
}

/** The inbox will show invalid drafts for correction, never send them to the editor. */
export function parsePurchaseBillDraft(schemaVersion: unknown, payload: unknown):
  | { kind: 'valid'; value: PurchaseBillDraftPayloadV1 }
  | { kind: 'invalid'; issues: string[] } {
  if (schemaVersion === 1) {
    const parsed = purchaseBillDraftPayloadV1.safeParse(payload)
    return parsed.success ? validateLineMath(parsed.data) : invalid(parsed.error.issues)
  }
  if (schemaVersion !== 2) return { kind: 'invalid', issues: ['Unsupported draft schema version'] }
  const parsed = purchaseBillDraftPayloadV2.safeParse(payload)
  if (!parsed.success) return invalid(parsed.error.issues)
  const p = parsed.data
  try {
    const pool = p.pool ?? 'kacha'
    const taxMode = pool === 'kacha' ? 'none' : (p.tax_mode === 'rcm' ? 'rcm' : 'gst')
    const value: PurchaseBillDraftPayloadV1 = {
      supplier_id: p.supplier_id, supplier_name: p.supplier_name, date: p.date,
      supplier_bill_no: p.supplier_bill_no, pool, tax_mode: taxMode,
      gst_rate_bp: p.gst_rate_bp, vehicle_no: p.vehicle_no, private_note: p.private_note,
      stated_total_paise: p.stated_total_rs == null ? undefined : parsePurchaseDecimal(p.stated_total_rs, 2, 'Stated total'),
      lines: p.lines.map((line, i) => {
        const weight_g = parsePurchaseDecimal(line.weight_kg, 3, `Line ${i + 1} weight`)
        const rate_milli = parsePurchaseDecimal(line.rate_rs_per_kg, 3, `Line ${i + 1} rate`)
        return {
          item_id: line.item_id, item_name: line.item_name, weight_g, rate_milli,
          amount_paise: line.amount_rs == null ? calculateDraftLinePaise(weight_g, rate_milli) : parsePurchaseDecimal(line.amount_rs, 2, `Line ${i + 1} amount`),
          receipt_memo: line.receipt_memo,
        }
      }),
      adjustments: p.adjustments?.map((a, i) => ({ type: a.type, amount_paise: parsePurchaseDecimal(a.amount_rs, 2, `Adjustment ${i + 1}`), note: a.note })),
      bardan: p.bardan?.map((b, i) => ({
        bardan_g: parsePurchaseDecimal(b.weight_kg, 3, `Bardan ${i + 1} weight`),
        rate_line_index: b.rate_line_index, rate_milli: parsePurchaseDecimal(b.rate_rs_per_kg, 3, `Bardan ${i + 1} rate`),
        method: b.method, credit_paise: b.credit_rs == null ? undefined : parsePurchaseDecimal(b.credit_rs, 2, `Bardan ${i + 1} credit`),
        cash_amount_paise: b.cash_amount_rs == null ? undefined : parsePurchaseDecimal(b.cash_amount_rs, 2, `Bardan ${i + 1} cash`),
        date: b.date, note: b.note,
      })),
      payment: p.payment && { amount_paise: parsePurchaseDecimal(p.payment.amount_rs, 2, 'Payment'), mode: p.payment.mode, reference: p.payment.reference, note: p.payment.note },
    }
    const checked = purchaseBillDraftPayloadV1.safeParse(value)
    return checked.success ? validateLineMath(checked.data) : invalid(checked.error.issues)
  } catch (error) {
    return { kind: 'invalid', issues: [error instanceof Error ? error.message : 'Invalid decimal value'] }
  }
}
