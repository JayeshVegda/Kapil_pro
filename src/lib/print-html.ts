/**
 * Reliable HTML print / Save as PDF helpers.
 * A 0×0 hidden iframe often yields blank output; use a full-viewport invisible frame instead.
 */

const PRINT_DELAY_MS = 450

export function printHtmlInHiddenIframe(html: string): boolean {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;border:0;opacity:0;pointer-events:none;z-index:-1'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return false
  }
  doc.open()
  doc.write(html)
  doc.close()
  window.setTimeout(() => {
    try {
      win.focus()
      win.print()
    } finally {
      window.setTimeout(() => frame.remove(), 2500)
    }
  }, PRINT_DELAY_MS)
  return true
}

/** Opens a real window, writes HTML, then prints after layout (better PDF preview than 0×0 iframe). */
export function openAndPrintHtml(html: string): Window | null {
  const win = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=1280')
  if (!win) return null
  win.document.write(html)
  win.document.close()
  window.setTimeout(() => {
    win.focus()
    win.print()
  }, PRINT_DELAY_MS)
  return win
}
