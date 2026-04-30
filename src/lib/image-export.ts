import html2canvas from 'html2canvas'
import { toBlob as nodeToBlob } from 'html-to-image'

type ExportOptions = {
  filename: string
  quality?: number
  backgroundColor?: string
  preferredWidthPx?: number
  maxHeightPx?: number
}

const MAX_EXPORT_PIXELS = 12_000_000

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function computePixelRatio(node: HTMLElement) {
  const width = Math.max(1, Math.round(node.offsetWidth))
  const height = Math.max(1, Math.round(node.offsetHeight))
  const baseRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 2))
  const maxRatio = Math.sqrt(MAX_EXPORT_PIXELS / (width * height))
  return Number.isFinite(maxRatio) ? Math.max(1, Math.min(baseRatio, maxRatio)) : 1
}

export async function exportNodeAsJpgBlob(node: HTMLElement, options: Omit<ExportOptions, 'filename'>) {
  const quality = options.quality ?? 0.95
  const backgroundColor = options.backgroundColor ?? '#ffffff'
  if ('fonts' in document) {
    await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready
  }
  const pixelRatio = computePixelRatio(node)
  const sourceWidth = Math.max(1, Math.round(node.scrollWidth || node.offsetWidth || 1))
  const sourceHeight = Math.max(1, Math.round(node.scrollHeight || node.offsetHeight || 1))
  const preferredWidth = options.preferredWidthPx && options.preferredWidthPx > 0 ? options.preferredWidthPx : sourceWidth
  const widthScale = preferredWidth / sourceWidth
  const preferredHeightRaw = Math.max(1, Math.round(sourceHeight * widthScale))
  const maxHeight = options.maxHeightPx && options.maxHeightPx > 0 ? options.maxHeightPx : preferredHeightRaw
  const outputHeight = Math.min(preferredHeightRaw, maxHeight)
  const outputWidth = Math.max(1, Math.round((sourceWidth * outputHeight) / sourceHeight))

  // Strategy 1: html-to-image (usually better fidelity for styled DOM trees)
  try {
    const blob = await nodeToBlob(node, {
      quality,
      cacheBust: true,
      pixelRatio,
      backgroundColor,
      skipAutoScale: false,
      canvasWidth: outputWidth,
      canvasHeight: outputHeight,
    })
    if (blob) {
      return blob
    }
  } catch {
    // Continue to html2canvas fallback.
  }

  // Strategy 2: html2canvas fallback (better compatibility in some browsers)
  const canvas = await html2canvas(node, {
    scale: Math.max(1, pixelRatio * (outputWidth / sourceWidth)),
    useCORS: true,
    allowTaint: false,
    backgroundColor,
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (blob) {
    return blob
  }

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const fallbackResponse = await fetch(dataUrl)
  return fallbackResponse.blob()
}

export async function exportNodeAsJpg(node: HTMLElement, options: ExportOptions) {
  const blob = await exportNodeAsJpgBlob(node, options)
  downloadBlob(blob, options.filename)
}
