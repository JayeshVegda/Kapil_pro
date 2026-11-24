import { brassRateSeries, normalizeBrassRateHistory } from '@/domain/brass-rate-report'
import { pb } from './pocketbase'

export async function loadBrassRateHistory() {
  const records = await pb.collection('brass_rates').getFullList({
    sort: 'date,id',
    fields: ['date', ...brassRateSeries.map(({ key }) => key)].join(','),
  })
  return normalizeBrassRateHistory(records)
}
