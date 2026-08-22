import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import type { BillPrintData } from './pocketbase.js'

const BILL_PRINT_PAGE_WIDTH_CM = 14
const BILL_PRINT_DOCUMENT_TITLE = 'Kapil Products - Bill'
const BILL_PRINT_JPEG_QUALITY_SHARE = 93

let browserPromise: Promise<Browser> | null = null
let cssPromise: Promise<string> | null = null

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatFullDate(dateText: string) {
  if (!dateText || dateText === 'Opening') return dateText || '-'
  const parsed = new Date(`${dateText.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateText
  const day = String(parsed.getDate()).padStart(2, '0')
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  return `${day}-${month}-${parsed.getFullYear()}`
}

const inrNumber = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

function formatInrInteger(value: number) {
  const n = Math.round(Number.isFinite(value) ? value : 0)
  return `₹${inrNumber.format(n)}`
}

async function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  return browserPromise
}

async function getBillPrintCss() {
  cssPromise ??= readFile(join(process.cwd(), 'src/components/billing/bill-print.css'), 'utf8')
  return cssPromise
}

function popupStyles(sharedCss: string) {
  return `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { height: auto; }
    body {
      margin: 0;
      padding: 4mm;
      font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .preview-print {
      width: ${BILL_PRINT_PAGE_WIDTH_CM}cm;
      max-width: 100%;
      margin: 0 auto;
    }
    .bill-preview-card {
      width: ${BILL_PRINT_PAGE_WIDTH_CM}cm;
      max-width: 100%;
      flex-shrink: 0;
      border-radius: 0.5rem;
      border: 1px solid #cbd5e1;
      background: #fff;
      padding: 1rem;
      color: #1e293b;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
    }
    ${sharedCss}
  `
}

function renderRows(data: BillPrintData) {
  const itemRows = data.itemRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.itemName)}</td>
      <td class="bill-print-col-qty">${htmlEscape(row.qty)} kg</td>
      <td class="bill-print-col-rate">${htmlEscape(formatInrInteger(row.rate))}</td>
      <td class="bill-print-col-amt">${htmlEscape(formatInrInteger(row.amount))}</td>
    </tr>
  `)
  if (data.gstAmount > 0) {
    itemRows.push(`
      <tr>
        <td>${htmlEscape(data.gstRate > 0 ? `GST (${data.gstRate}%)` : 'GST')}</td>
        <td class="bill-print-col-qty"></td>
        <td class="bill-print-col-rate"></td>
        <td class="bill-print-col-amt">${htmlEscape(formatInrInteger(data.gstAmount))}</td>
      </tr>
    `)
  }
  if (data.transport > 0) {
    itemRows.push(`
      <tr>
        <td>Transport</td>
        <td class="bill-print-col-qty"></td>
        <td class="bill-print-col-rate"></td>
        <td class="bill-print-col-amt">+ ${htmlEscape(formatInrInteger(data.transport))}</td>
      </tr>
    `)
  }
  return itemRows.join('')
}

function renderCredits(data: BillPrintData) {
  if (data.periodCreditEntries.length === 0) return ''
  return `
    <div class="bill-print-credits">
      ${data.periodCreditEntries.map((entry) => `
        <div class="bill-print-credit-line">
          <span>Credited on ${htmlEscape(formatFullDate(entry.date))}</span>
          <span class="bill-print-summary-value" style="font-size: 11px">- ${htmlEscape(formatInrInteger(entry.amount))}</span>
        </div>
      `).join('')}
    </div>
  `
}

function renderPreviousBalance(data: BillPrintData) {
  if (data.previousBalance === 0) return ''
  const label = data.previousBalance >= 0 ? 'Previous Balance' : 'Previous Advance'
  const sign = data.previousBalance >= 0 ? '+ ' : '- '
  const dateLabel = data.previousBillDate === 'Opening' ? 'Opening' : formatFullDate(data.previousBillDate)
  return `
    <div class="bill-print-summary-line">
      <span class="bill-print-summary-label">${label} [dt. ${htmlEscape(dateLabel)}]</span>
      <span class="bill-print-summary-value">${sign}${htmlEscape(formatInrInteger(Math.abs(data.previousBalance)))}</span>
    </div>
  `
}

function billPrintLayout(data: BillPrintData) {
  return `
    <div class="bill-print-root">
      <div class="bill-print-header">
        <div>
          <p style="margin: 0; font-size: 13px; font-weight: 600">Kapil Products</p>
          <p style="margin: 4px 0 0; font-size: 11px; color: #475569">MKT: ${htmlEscape(data.mkt)}</p>
        </div>
        <div class="bill-print-header-meta">
          <p style="margin: 0">Date: <strong>${htmlEscape(formatFullDate(data.date))}</strong></p>
          <p style="margin: 4px 0 0">No: ${htmlEscape(data.bookNo)}/${htmlEscape(data.billNo)}</p>
        </div>
      </div>

      <p class="bill-print-party">M/s. <strong>${htmlEscape(data.customerName)}</strong></p>

      <table class="bill-print-table">
        <colgroup>
          <col style="width: 34%" />
          <col style="width: 18%" />
          <col style="width: 22%" />
          <col style="width: 26%" />
        </colgroup>
        <thead>
          <tr>
            <th>Particulars</th>
            <th class="bill-print-col-qty">Qty</th>
            <th class="bill-print-col-rate">Rate</th>
            <th class="bill-print-col-amt">Amount</th>
          </tr>
        </thead>
        <tbody>${renderRows(data)}</tbody>
      </table>

      <hr class="bill-print-divider" />

      <div class="bill-print-summary">
        <div class="bill-print-summary-line">
          <span class="bill-print-summary-label">Current Bill Total</span>
          <span class="bill-print-summary-value">${htmlEscape(formatInrInteger(data.currentBillTotal))}</span>
        </div>
        ${renderPreviousBalance(data)}
        <div class="bill-print-summary-line">
          <span class="bill-print-summary-label">Sub Total</span>
          <span class="bill-print-summary-value">${htmlEscape(formatInrInteger(data.subtotal))}</span>
        </div>
        ${renderCredits(data)}
        <div class="bill-print-total">
          <span>${data.finalTotal >= 0 ? 'Total' : 'Advance Balance'}</span>
          <span class="bill-print-summary-value">${htmlEscape(formatInrInteger(Math.abs(data.finalTotal)))}</span>
        </div>
      </div>

      <div class="bill-print-footer">
        <div>
          <p class="bill-print-footer-label">Weight</p>
          <p class="bill-print-footer-value">${htmlEscape(Math.round(data.totalQty))} kg</p>
        </div>
        <div>
          <p class="bill-print-footer-label">Bags</p>
          <p class="bill-print-footer-value">${htmlEscape(Math.round(data.totalBags))}</p>
        </div>
        <div>
          <p class="bill-print-footer-label">LR No.</p>
          <p class="bill-print-footer-value">${data.lrList.length ? htmlEscape(data.lrList.join(', ')) : '-'}</p>
        </div>
      </div>
    </div>
  `
}

async function buildBillPrintHtmlDocument(data: BillPrintData) {
  const sharedCss = await getBillPrintCss()
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BILL_PRINT_DOCUMENT_TITLE}</title>
    <style>${popupStyles(sharedCss)}</style>
  </head>
  <body>
    <div class="preview-print">
      <div class="bill-preview-card">${billPrintLayout(data)}</div>
    </div>
  </body>
</html>`
}

export async function createBillPrintJpeg(data: BillPrintData) {
  const browser = await getBrowser()
  const page = await browser.newPage({
    viewport: { width: 900, height: 1600 },
    deviceScaleFactor: 4,
  })

  try {
    await page.setContent(await buildBillPrintHtmlDocument(data), { waitUntil: 'load' })
    await page.locator('.bill-preview-card').waitFor({ state: 'visible' })
    return await page.locator('.bill-preview-card').screenshot({
      type: 'jpeg',
      quality: BILL_PRINT_JPEG_QUALITY_SHARE,
    })
  } finally {
    await page.close()
  }
}
