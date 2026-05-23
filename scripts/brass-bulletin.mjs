const RATE_FIELDS = ['vilaity', 'honey_gulf', 'honey_europe']

export function parseBrassBulletinsFromRss(xmlText) {
  return getBulletinItems(xmlText)
    .map(parseBrassBulletinItem)
    .filter(Boolean)
}

export function parseBrassBulletinFromRss(xmlText) {
  const item = getBulletinItems(xmlText)[0]
  if (!item) return null
  return parseBrassBulletinItem(item)
}

function parseBrassBulletinItem(item) {
  const description = getTagValue(item, 'description')
  const text = cleanHtml(description)
  if (!/BrassB2B\s+Rate\s+Bulletin/i.test(text)) return null

  const dateMatch = text.match(/Date\s*:\s*(\d{1,2})[./](\d{1,2})[./](\d{4})/i)
  if (!dateMatch) return null
  const date = `${dateMatch[3]}-${pad2(dateMatch[2])}-${pad2(dateMatch[1])}`
  const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*([A-Za-z]+)?/i)

  const jamnagarBlock = blockBetween(text, /Jamnagar/i, [/Delhi/i])
  const zincBlock = blockBetween(text, /Zinc\s+Ingots/i, [/Delhi/i])
  const delhiBlock = blockBetween(text, /Delhi/i, [/MCX/i])
  const mcxBlock = blockBetween(text, /MCX/i, [/LME\s*3M/i])

  const parsed = {
    date,
    bulletin_time: normalizeTime(timeMatch?.[1] || ''),
    weekday: stripPunctuation(timeMatch?.[2] || ''),
    source: 'brassb2b_rss',
    rss_guid: cleanHtml(getTagValue(item, 'guid')),
    rss_link: cleanHtml(getTagValue(item, 'link')),
    raw_text: text,

    jamnagar_trend: trendNear(jamnagarBlock.match(/Brass\s+Scrap[^\n]*/i)?.[0] || ''),
    honey_gulf: numberAfterLabel(jamnagarBlock, /Honey\s+Gulf\.?/i),
    honey_gulf_trend: trendAfterLabel(jamnagarBlock, /Honey\s+Gulf\.?/i),
    honey_europe: numberAfterLabel(jamnagarBlock, /Honey\s+Europe(?:\/U\.?K\.?)?\.?/i),
    honey_europe_trend: trendAfterLabel(jamnagarBlock, /Honey\s+Europe(?:\/U\.?K\.?)?\.?/i),
    vilaity: numberAfterLabel(jamnagarBlock, /(?:Brass\s+)?Vi[la]{2,3}ity(?:\.\s*\(Local\))?/i),
    vilaity_trend: trendAfterLabel(jamnagarBlock, /(?:Brass\s+)?Vi[la]{2,3}ity(?:\.\s*\(Local\))?/i),

    zinc_trend: trendNear(zincBlock.match(/Zinc\s+Ingots[^\n]*/i)?.[0] || ''),
    plant_pass: numberAfterLabel(zincBlock, /Plant\s+Pass/i),
    plant_pass_trend: trendAfterLabel(zincBlock, /Plant\s+Pass/i),
    zinc_9995: numberAfterLabel(zincBlock, /Zinc\s+99\.?95/i),
    zinc_9995_trend: trendAfterLabel(zincBlock, /Zinc\s+99\.?95/i),

    delhi_honey: numberAfterLabel(delhiBlock, /Honey/i),
    delhi_honey_trend: trendAfterLabel(delhiBlock, /Honey/i),
    delhi_local: numberAfterLabel(delhiBlock, /Local/i),
    delhi_local_trend: trendAfterLabel(delhiBlock, /Local/i),
    armature: numberAfterLabel(delhiBlock, /Armature/i),
    armature_trend: trendAfterLabel(delhiBlock, /Armature/i),

    mcx_status: parseMcxStatus(text),
    mcx_copper: numberAfterLabel(mcxBlock, /Copper/i),
    mcx_copper_trend: trendAfterLabel(mcxBlock, /Copper/i),
    mcx_zinc: numberAfterLabel(mcxBlock, /Zinc/i),
    mcx_zinc_trend: trendAfterLabel(mcxBlock, /Zinc/i),

    lme_3m: numberAfterLabel(text, /LME\s*3M/i),
    lme_3m_trend: trendAfterLabel(text, /LME\s*3M/i),
    usd_inr: numberAfterLabel(text, /\$\/₹/i),
    usd_inr_trend: trendAfterLabel(text, /\$\/₹/i),
  }

  if (!parsed.vilaity && !parsed.honey_gulf && !parsed.honey_europe) return null
  return parsed
}

export function formatRateAlertMessage(current, previous) {
  if (!current) return 'No brass rate found.'
  const ref = previous ? formatShortDate(previous.date) : '—'
  const lines = [
    `<b>Brass Rates Update</b> | <code>${escapeHtml(formatShortDate(current.date))}</code>`,
    `<b>Ref Date</b>: <code>${escapeHtml(ref)}</code>`,
    '',
    rateLine('Vilaity', current.vilaity, previous?.vilaity),
    rateLine('Honey Gulf', current.honey_gulf, previous?.honey_gulf),
    rateLine('Honey Europe', current.honey_europe, previous?.honey_europe),
    '',
    `<b>Delhi</b>: Honey <code>${numText(current.delhi_honey)}</code>, Local <code>${numText(current.delhi_local)}</code>`,
    `<b>Zinc</b>: Plant <code>${numText(current.plant_pass)}</code>, 99.95 <code>${numText(current.zinc_9995)}</code>`,
    `<b>MCX</b>: Copper <code>${numText(current.mcx_copper)}</code>, Zinc <code>${numText(current.mcx_zinc)}</code>`,
    `<b>LME 3M</b>: <code>${numText(current.lme_3m)}</code> | <b>$/₹</b>: <code>${numText(current.usd_inr)}</code>`,
  ]
  return lines.join('\n')
}

export function formatRateAnalyticsMessage(current, rows) {
  if (!current) return 'No brass rate found.'
  const windows = [
    [3, '3 Days'],
    [7, '7 Days'],
    [30, '30 Days'],
  ]
  const lines = [
    `<b>Price Change Analysis</b> | <code>${escapeHtml(formatShortDate(current.date))}</code>`,
    '────────────',
  ]
  for (const [days, label] of windows) {
    const base = findBaselineRow(rows, current.date, days)
    lines.push('', windowBlock(label, current, base))
  }
  return lines.join('\n')
}

export function toPocketBasePayload(parsed) {
  return {
    date: parsed.date,
    vilaity: numberOrZero(parsed.vilaity),
    honey_gulf: numberOrZero(parsed.honey_gulf),
    honey_europe: numberOrZero(parsed.honey_europe),
    source: parsed.source || 'brassb2b_rss',
    note: 'BrassB2B full bulletin',
    weekday: parsed.weekday || '',
    bulletin_time: parsed.bulletin_time || '',
    rss_guid: parsed.rss_guid || '',
    rss_link: parsed.rss_link || '',
    raw_text: parsed.raw_text || '',
    jamnagar_trend: parsed.jamnagar_trend || '',
    honey_gulf_trend: parsed.honey_gulf_trend || '',
    honey_europe_trend: parsed.honey_europe_trend || '',
    vilaity_trend: parsed.vilaity_trend || '',
    zinc_trend: parsed.zinc_trend || '',
    plant_pass: numberOrZero(parsed.plant_pass),
    plant_pass_trend: parsed.plant_pass_trend || '',
    zinc_9995: numberOrZero(parsed.zinc_9995),
    zinc_9995_trend: parsed.zinc_9995_trend || '',
    delhi_honey: numberOrZero(parsed.delhi_honey),
    delhi_honey_trend: parsed.delhi_honey_trend || '',
    delhi_local: numberOrZero(parsed.delhi_local),
    delhi_local_trend: parsed.delhi_local_trend || '',
    armature: numberOrZero(parsed.armature),
    armature_trend: parsed.armature_trend || '',
    mcx_status: parsed.mcx_status || '',
    mcx_copper: numberOrZero(parsed.mcx_copper),
    mcx_copper_trend: parsed.mcx_copper_trend || '',
    mcx_zinc: numberOrZero(parsed.mcx_zinc),
    mcx_zinc_trend: parsed.mcx_zinc_trend || '',
    lme_3m: numberOrZero(parsed.lme_3m),
    lme_3m_trend: parsed.lme_3m_trend || '',
    usd_inr: numberOrZero(parsed.usd_inr),
    usd_inr_trend: parsed.usd_inr_trend || '',
  }
}

function getBulletinItems(xmlText) {
  const items = String(xmlText || '').match(/<item\b[\s\S]*?<\/item>/gi) || []
  return items.filter((item) => /BrassB2B\s+Rate\s+Bulletin/i.test(cleanHtml(getTagValue(item, 'description'))))
}

function getTagValue(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return decodeCdata(match?.[1] || '')
}

function cleanHtml(value) {
  return decodeEntities(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeCdata(value) {
  return String(value || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function blockBetween(text, startPattern, endPatterns) {
  const start = text.search(startPattern)
  if (start < 0) return ''
  const rest = text.slice(start)
  const end = endPatterns
    .map((pattern) => {
      const match = rest.slice(1).search(pattern)
      return match < 0 ? -1 : match + 1
    })
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0]
  return end ? rest.slice(0, end) : rest
}

function numberAfterLabel(text, labelPattern) {
  const label = sourceOf(labelPattern)
  const match = String(text || '').match(new RegExp(`${label}[^:\\n]*:\\s*\\.?\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'))
  return match ? Number(match[1]) : 0
}

function trendAfterLabel(text, labelPattern) {
  const label = sourceOf(labelPattern)
  const match = String(text || '').match(new RegExp(`${label}[^\\n]*`, 'i'))
  return trendNear(match?.[0] || '')
}

function trendNear(text) {
  if (/⬆|▲/u.test(text)) return 'up'
  if (/⬇|▼/u.test(text)) return 'down'
  if (/↔|→/u.test(text)) return 'flat'
  return 'neutral'
}

function parseMcxStatus(text) {
  const line = String(text || '').split('\n').find((part) => /MCX/i.test(part)) || ''
  return stripPunctuation(line.replace(/.*MCX/i, '').trim())
}

function findBaselineRow(rows, targetDate, days) {
  const target = new Date(`${String(targetDate).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(target.getTime())) return null
  const cutoff = new Date(target)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  return [...(rows || [])]
    .filter((row) => {
      const d = new Date(`${String(row.date || '').slice(0, 10)}T00:00:00Z`)
      return Number.isFinite(d.getTime()) && d <= cutoff
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .at(-1) || null
}

function windowBlock(label, current, base) {
  if (!base) return `<b>${escapeHtml(label)}</b>\n• <i>Insufficient history</i>`
  return [
    `<b>${escapeHtml(label)}</b> <i>(vs ${escapeHtml(formatShortDate(base.date))})</i>`,
    rateLine('Vilaity', current.vilaity, base.vilaity),
    rateLine('Honey Gulf', current.honey_gulf, base.honey_gulf),
    rateLine('Honey Europe', current.honey_europe, base.honey_europe),
  ].join('\n')
}

function rateLine(label, current, previous) {
  return `• <b>${escapeHtml(label)}</b>: <code>${numText(current)}</code> <i>(${deltaBadge(current, previous)})</i>`
}

function deltaBadge(current, previous) {
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (!cur || !prev) return '—'
  const diff = Math.round(cur - prev)
  if (diff > 0) return `▲ +${diff}`
  if (diff < 0) return `▼ ${diff}`
  return '• 0'
}

function formatShortDate(value) {
  const d = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(d.getTime())) return String(value || '—').slice(0, 10)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

function numText(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0) return '—'
  return Number.isInteger(n) ? String(n) : String(n)
}

function numberOrZero(value) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sourceOf(pattern) {
  return pattern instanceof RegExp ? pattern.source : String(pattern)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function normalizeTime(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase()
}

function stripPunctuation(value) {
  return String(value || '').replace(/[.。]+$/g, '').trim()
}
