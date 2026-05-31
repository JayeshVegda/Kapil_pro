import billPrintSharedCss from './bill-print.css?raw'

/**
 * Full CSS for bill print popups / Save as PDF — includes @page and .preview-print width.
 * Uses shared rules from bill-print.css (same file as on-screen preview import).
 */
export function getBillPrintPopupStyles(contentWidthCm: number) {
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
      width: ${contentWidthCm}cm;
      max-width: 100%;
      margin: 0 auto;
    }
    ${billPrintSharedCss}
  `
}
