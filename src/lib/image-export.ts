import html2canvas from 'html2canvas'
import { toCanvas } from 'html-to-image'

type ExportOptions = {
  filename: string
  quality?: number
  backgroundColor?: string
  /** If set, output JPEG is scaled to this width (px); aspect ratio preserved. Must not be passed as html-to-image width/height (that only pads with empty space). */
  preferredWidthPx?: number
  maxHeightPx?: number
}

/** Cap raster budget (logical w×h × ratio²) so tall bills don’t exceed canvas limits. */
const MAX_EXPORT_PIXELS = 52_000_000

/** Default JPG width after capture (px). ~2× a phone full-width screen for readable small type. */
export const BILL_JPEG_OUTPUT_WIDTH_PX = 2160

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function measureNode(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || node.offsetWidth || node.clientWidth))
  const height = Math.max(1, Math.round(Math.max(node.scrollHeight, node.offsetHeight, rect.height)))
  return { width, height }
}

/** Higher than screen DPR so exports stay sharp on 1× displays; capped for memory / huge bills. */
function clampPixelRatio(logicalW: number, logicalH: number) {
  const dpr = window.devicePixelRatio || 1
  const area = logicalW * logicalH
  const maxFromBudget = Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, area))
  const desired = Math.min(4, Math.max(3, dpr * 1.25))
  if (!Number.isFinite(maxFromBudget)) return Math.min(desired, 4)
  return Math.max(1, Math.min(desired, maxFromBudget, 4))
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

/** Scale canvas to target width (px); preserves height ratio. Avoids empty margins from html-to-image width/height hacks. */
function resampleCanvasToWidth(source: HTMLCanvasElement, targetW: number): HTMLCanvasElement {
  if (targetW <= 0 || !Number.isFinite(targetW)) return source
  const tw = Math.round(targetW)
  if (tw < 1 || source.width < 1) return source
  const scale = tw / source.width
  if (Math.abs(scale - 1) < 0.005) return source
  const th = Math.max(1, Math.round(source.height * scale))
  const out = document.createElement('canvas')
  out.width = tw
  out.height = th
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, tw, th)
  ctx.drawImage(source, 0, 0, tw, th)
  return out
}

function applyMaxHeight(canvas: HTMLCanvasElement, maxH: number): HTMLCanvasElement {
  if (maxH <= 0 || canvas.height <= maxH) return canvas
  const scale = maxH / canvas.height
  const tw = Math.max(1, Math.round(canvas.width * scale))
  const th = Math.round(maxH)
  const out = document.createElement('canvas')
  out.width = tw
  out.height = th
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, tw, th)
  ctx.drawImage(canvas, 0, 0, tw, th)
  return out
}

export async function exportNodeAsJpgBlob(node: HTMLElement, options: Omit<ExportOptions, 'filename'>) {
  const quality = options.quality ?? 0.95
  const backgroundColor = options.backgroundColor ?? '#ffffff'
  if ('fonts' in document) {
    await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready
  }

  const { width: baseW, height: baseH } = measureNode(node)
  const pixelRatio = clampPixelRatio(baseW, baseH)

  let canvas: HTMLCanvasElement | null = null

  try {
    canvas = await toCanvas(node, {
      pixelRatio,
      backgroundColor,
      cacheBust: true,
      skipFonts: true,
    })
  } catch {
    // Fall back to html2canvas below.
  }

  if (!canvas || canvas.width < 8 || canvas.height < 8) {
    try {
      canvas = await html2canvas(node, {
        scale: pixelRatio,
        width: baseW,
        height: baseH,
        useCORS: true,
        allowTaint: true,
        backgroundColor,
        logging: false,
      })
    } catch {
      // The final guard below reports a clear export error.
    }
  }

  if (!canvas || canvas.width < 8 || canvas.height < 8) {
    throw new Error('Could not rasterize bill for JPG')
  }

  let out = canvas
  if (options.preferredWidthPx && options.preferredWidthPx > 0) {
    out = resampleCanvasToWidth(out, options.preferredWidthPx)
  }
  if (options.maxHeightPx && options.maxHeightPx > 0) {
    out = applyMaxHeight(out, options.maxHeightPx)
  }

  const blob = await canvasToJpegBlob(out, quality)
  if (blob && blob.size > 400) return blob

  const dataUrl = out.toDataURL('image/jpeg', quality)
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function exportNodeAsJpg(node: HTMLElement, options: ExportOptions) {
  const blob = await exportNodeAsJpgBlob(node, options)
  downloadBlob(blob, options.filename)
}
