export const TELEGRAM_TEXT_LIMIT = 4096
export const TELEGRAM_CAPTION_LIMIT = 1024

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function b(value: unknown) {
  return `<b>${escapeHtml(value)}</b>`
}

export function i(value: unknown) {
  return `<i>${escapeHtml(value)}</i>`
}

export function code(value: unknown) {
  return `<code>${escapeHtml(value)}</code>`
}

export function pre(value: unknown) {
  return `<pre>${escapeHtml(value)}</pre>`
}

export function heading(icon: string, text: string, meta = '') {
  return `${icon} ${b(text)}${meta ? `\n${escapeHtml(meta)}` : ''}`
}

export function joinBlocks(blocks: Array<string | false | null | undefined>) {
  return blocks.filter((block): block is string => Boolean(block && block.trim())).join('\n\n')
}

export function truncateText(value: unknown, max: number) {
  const text = String(value ?? '')
  if (text.length <= max) return text
  if (max <= 1) return '…'
  return `${text.slice(0, max - 1)}…`
}

export function inr(value: number) {
  const formatter = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
  return `₹${formatter.format(Math.round(Number.isFinite(value) ? value : 0))}`
}

export function qty(value: number, unit = 'kg') {
  const formatter = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })
  return `${formatter.format(Number.isFinite(value) ? value : 0)} ${unit}`.trim()
}

export function fullDate(iso: string) {
  if (!iso) return '-'
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function splitPlainText(input: string, limit: number) {
  const chunks: string[] = []
  let rest = input
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit)
    if (cut < 1) cut = limit
    chunks.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export function splitTelegramHtml(message: string, limit = TELEGRAM_TEXT_LIMIT) {
  if (message.length <= limit) return [message]

  const blocks = message.split(/\n\n/)
  if (blocks.length > 1) {
    const chunks: string[] = []
    let current = ''

    for (const block of blocks) {
      if (!block) continue
      const candidate = current ? `${current}\n\n${block}` : block
      if (candidate.length <= limit) {
        current = candidate
        continue
      }
      if (current) chunks.push(current)
      if (block.length <= limit) {
        current = block
        continue
      }
      chunks.push(...splitPlainText(block, limit))
      current = ''
    }

    if (current) chunks.push(current)
    return chunks
  }

  return splitPlainText(message, limit)
}

function tableDivider(header: string) {
  return '━'.repeat(Math.max(12, Math.min(header.length, 72)))
}

export function paginatePreTable(options: {
  icon: string
  title: string
  meta?: string
  header: string
  rows: string[]
  emptyHint: string
  limit?: number
}) {
  const limit = options.limit ?? TELEGRAM_TEXT_LIMIT
  if (options.rows.length === 0) {
    return [joinBlocks([heading(options.icon, options.title), escapeHtml(options.emptyHint)])]
  }

  const divider = tableDivider(options.header)
  const makeTable = (rows: string[]) => pre([options.header, divider, ...rows].join('\n'))
  const buildMessage = (rows: string[], meta: string) => joinBlocks([
    heading(options.icon, options.title, meta),
    makeTable(rows),
  ])

  const rowChunks: string[][] = []
  let currentRows: string[] = []

  for (const row of options.rows) {
    const nextRows = [...currentRows, row]
    const probe = buildMessage(nextRows, options.meta || '')
    if (probe.length <= limit || currentRows.length === 0) {
      currentRows = nextRows
      continue
    }
    rowChunks.push(currentRows)
    currentRows = [row]
  }

  if (currentRows.length) rowChunks.push(currentRows)

  return rowChunks.map((rows, index) => {
    const pageSuffix = rowChunks.length > 1 ? ` · ${index + 1}/${rowChunks.length}` : ''
    const baseMeta = options.meta ? `${options.meta}${pageSuffix}` : `${options.rows.length} rows${pageSuffix}`
    return buildMessage(rows, baseMeta)
  })
}

export function clampTelegramCaption(html: string, limit = TELEGRAM_CAPTION_LIMIT) {
  if (html.length <= limit) return html
  const chunks = splitTelegramHtml(html, limit)
  return chunks[0]?.slice(0, limit) ?? ''
}
