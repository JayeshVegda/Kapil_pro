import { pb } from '@/data/pocketbase'
import type { PBRecord } from '@/data/dashboard'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function boundsForMonthKey(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number)
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) {
    throw new Error('Invalid month key')
  }
  const start = `${yearRaw}-${pad2(monthRaw)}-01`
  const lastDay = new Date(yearRaw, monthRaw, 0).getDate()
  const end = `${yearRaw}-${pad2(monthRaw)}-${pad2(lastDay)}`
  return { start, end }
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number)
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthKey
  const d = new Date(yearRaw, monthRaw - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/**
 * Loads only bills, line items, payments, and brass rates for one calendar month.
 * Also loads brass_rates for the **previous** calendar month (for avg rate vs LM).
 * Bill items are fetched in small chunks to avoid huge single responses and long filter URLs.
 */
export async function loadCalendarMonthData(monthKey: string) {
  const { start, end } = boundsForMonthKey(monthKey)
  const prevStartEnd = boundsForMonthKey(shiftMonthKey(monthKey, -1))

  /** Same read access pattern as bills/payments; avoids failing the whole month if rules differ. */
  const listRatesBetween = async (rangeStart: string, rangeEnd: string): Promise<PBRecord[]> => {
    try {
      return (await pb.collection('brass_rates').getFullList({
        sort: 'date',
        filter: `date >= "${rangeStart}" && date <= "${rangeEnd}"`,
      })) as PBRecord[]
    } catch {
      return []
    }
  }

  const [billsRaw, prevBillsRaw, paymentsRaw, customersRaw, ratesRaw, prevRatesRaw] = await Promise.all([
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `date >= "${start}" && date <= "${end}"`,
    }) as Promise<PBRecord[]>,
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `date >= "${prevStartEnd.start}" && date <= "${prevStartEnd.end}"`,
    }) as Promise<PBRecord[]>,
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `date >= "${start}" && date <= "${end}"`,
    }) as Promise<PBRecord[]>,
    pb.collection('customers').getFullList({ sort: 'company_name,name' }) as Promise<PBRecord[]>,
    listRatesBetween(start, end),
    listRatesBetween(prevStartEnd.start, prevStartEnd.end),
  ])

  const loadBillItems = async (bills: PBRecord[]) => {
    const chunkSize = 12
    const chunks: PBRecord[][] = []
    for (let i = 0; i < bills.length; i += chunkSize) chunks.push(bills.slice(i, i + chunkSize))
    const results = await Promise.all(
      chunks.map((chunk) => {
        const filter = chunk.map((b) => `bill = "${b.id}"`).join(' || ')
        return filter ? pb.collection('bill_items').getFullList({ filter }) : Promise.resolve([])
      }),
    )
    return results.flat() as PBRecord[]
  }

  const [billItemsRaw, prevBillItemsRaw] = await Promise.all([
    loadBillItems(billsRaw),
    loadBillItems(prevBillsRaw),
  ])

  return {
    billsRaw,
    billItemsRaw,
    prevBillsRaw,
    prevBillItemsRaw,
    paymentsRaw,
    customersRaw,
    ratesRaw,
    prevRatesRaw,
    rangeStart: start,
    rangeEnd: end,
  }
}
