import PocketBase from 'pocketbase'
import { getPocketBaseUrl } from '@/app/env'

const baseUrl = getPocketBaseUrl()

export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

if (import.meta.env.DEV) {
  const slowQueryMs = 500
  const requestStartByUrl = new Map<string, number[]>()

  pb.beforeSend = (url, options) => {
    requestStartByUrl.set(url, [...(requestStartByUrl.get(url) ?? []), performance.now()])
    return { url, options }
  }

  pb.afterSend = (response, data) => {
    const startedAtList = requestStartByUrl.get(response.url) ?? []
    const startedAt = startedAtList.shift()
    if (startedAtList.length === 0) requestStartByUrl.delete(response.url)
    else requestStartByUrl.set(response.url, startedAtList)
    if (startedAt != null) {
      const elapsedMs = Math.round(performance.now() - startedAt)
      if (elapsedMs >= slowQueryMs) {
        const url = new URL(response.url)
        console.info(`[PocketBase slow query] ${elapsedMs}ms ${response.status} ${url.pathname}${url.search}`)
      }
    }
    return data
  }
}
