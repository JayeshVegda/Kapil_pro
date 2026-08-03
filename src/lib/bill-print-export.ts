import { BILL_PRINT_PAGE_WIDTH_CM } from '@/components/billing/bill-print-layout'
import { getBillPrintPopupStyles } from '@/components/billing/bill-print-styles'
import { openAndPrintHtml, printHtmlInHiddenIframe } from '@/lib/print-html'
import { BILL_JPEG_OUTPUT_WIDTH_PX } from '@/lib/image-export-config'

/** Single source of truth — Print bill and New bill must match. */
export const BILL_PRINT_JPEG_QUALITY_DOWNLOAD = 0.97
export const BILL_PRINT_JPEG_QUALITY_SHARE = 0.93

/** Browser print/PDF window title (both flows). */
export const BILL_PRINT_DOCUMENT_TITLE = 'Kapil Products – Bill'

export function buildBillPrintHtmlDocument(innerHtml: string, documentTitle: string) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${documentTitle}</title>
    <style>${getBillPrintPopupStyles(BILL_PRINT_PAGE_WIDTH_CM)}</style>
  </head>
  <body><div class="preview-print">${innerHtml}</div></body>
</html>`
}

export function printBillLayoutFromElement(
  element: HTMLElement,
  documentTitle: string,
  setStatus: (message: string) => void,
) {
  const printHtml = buildBillPrintHtmlDocument(element.innerHTML, documentTitle)
  const printWindow = openAndPrintHtml(printHtml)
  if (!printWindow) {
    const ok = printHtmlInHiddenIframe(printHtml)
    setStatus(
      ok ? 'Popup blocked. Used in-page print fallback.' : 'Print is blocked by browser settings. Please allow print popups.',
    )
    return
  }
  setStatus('')
}

export async function downloadBillLayoutAsJpg(element: HTMLElement, filename: string) {
  const { exportNodeAsJpg } = await import('@/lib/image-export')
  await exportNodeAsJpg(element, {
    filename,
    quality: BILL_PRINT_JPEG_QUALITY_DOWNLOAD,
    preferredWidthPx: BILL_JPEG_OUTPUT_WIDTH_PX,
  })
}

export async function createBillLayoutShareJpegBlob(element: HTMLElement) {
  const { exportNodeAsJpgBlob } = await import('@/lib/image-export')
  return exportNodeAsJpgBlob(element, {
    quality: BILL_PRINT_JPEG_QUALITY_SHARE,
    preferredWidthPx: BILL_JPEG_OUTPUT_WIDTH_PX,
  })
}

export async function shareBillLayoutImageWithWhatsAppFallback(options: {
  element: HTMLElement
  imageFilename: string
  message: string
  setStatus: (message: string) => void
}) {
  const { element, imageFilename, message, setStatus } = options

  try {
    if (typeof navigator.share === 'function') {
      const blob = await createBillLayoutShareJpegBlob(element)
      const file = new File([blob], imageFilename, { type: 'image/jpeg' })
      const attempts: ShareData[] = [{ files: [file] }, { files: [file], text: message }]
      for (const payload of attempts) {
        if (navigator.canShare && !navigator.canShare(payload)) continue
        await navigator.share(payload)
        setStatus('')
        return
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      setStatus('')
      return
    }
    setStatus('Native image share failed on this phone. Opening WhatsApp text fallback.')
  }

  const shareWindow = window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  if (!shareWindow) {
    setStatus('Could not open share options. Please allow popups and retry.')
    return
  }
  setStatus('Image share is not supported in this browser. WhatsApp opened with text.')
}

/** Wrapper around the bill preview node — keep identical on Print bill and New bill so JPG/print match. */
export const BILL_PREVIEW_CARD_CLASS =
  'shrink-0 rounded-lg border border-slate-300 bg-white p-4 text-slate-800 shadow-sm'
