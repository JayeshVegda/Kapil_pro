import { pb } from '@/data/pocketbase'
import type { PBRecord } from '@/data/dashboard'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * Loads only bills, line items, payments, and brass rates for one calendar month.
 * Bill items are fetched in small chunks to avoid huge single responses and long filter URLs.
 */
export async function loadCalendarMonthData(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number)
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) {
    throw new Error('Invalid month key')
  }
  const start = `${yearRaw}-${pad2(monthRaw)}-01`
  const lastDay = new Date(yearRaw, monthRaw, 0).getDate()
  const end = `${yearRaw}-${pad2(monthRaw)}-${pad2(lastDay)}`

  const [billsRaw, paymentsRaw, ratesRaw] = await Promise.all([
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `date >= "${start}" && date <= "${end}"`,
    }) as Promise<PBRecord[]>,
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `date >= "${start}" && date <= "${end}"`,
    }) as Promise<PBRecord[]>,
    pb.collection('brass_rates').getFullList({
      sort: 'date',
      filter: `date >= "${start}" && date <= "${end}"`,
    }) as Promise<PBRecord[]>,
  ])

  const billItemsRaw: PBRecord[] = []
  const chunkSize = 12
  for (let i = 0; i < billsRaw.length; i += chunkSize) {
    const chunk = billsRaw.slice(i, i + chunkSize)
    const filter = chunk.map((b) => `bill = "${b.id}"`).join(' || ')
    const rows = await pb.collection('bill_items').getFullList({ filter })
    billItemsRaw.push(...(rows as PBRecord[]))
  }

  return {
    billsRaw,
    billItemsRaw,
    paymentsRaw,
    ratesRaw,
    rangeStart: start,
    rangeEnd: end,
  }
}
