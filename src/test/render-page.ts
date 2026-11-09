import { PassThrough } from 'node:stream'
import type { ReactNode } from 'react'
import { renderToPipeableStream } from 'react-dom/server'

/** Wait for route code splitting without a browser or changes to runtime configuration. */
export function renderPage(node: ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const destination = new PassThrough()
    let html = ''
    destination.on('data', (chunk) => { html += String(chunk) })
    destination.on('end', () => resolve(html))
    destination.on('error', reject)
    const { pipe } = renderToPipeableStream(node, {
      onAllReady() { pipe(destination) },
      onError: reject,
    })
  })
}
