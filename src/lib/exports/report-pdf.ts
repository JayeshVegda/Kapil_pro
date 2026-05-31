import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PartyStatementViewModel } from './party-statement-presenter'

export function buildPartyStatementPdfModel(viewModel: PartyStatementViewModel) {
  return {
    title: viewModel.title,
    subtitle: viewModel.subtitle,
    summary: viewModel.summary,
    columns: viewModel.columns,
    rows: viewModel.rows,
  }
}

export function createPartyStatementPdf(viewModel: PartyStatementViewModel) {
  const model = buildPartyStatementPdfModel(viewModel)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, 78, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(model.title, 28, 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(226, 232, 240)
  doc.text(model.subtitle, 28, 48)
  doc.setTextColor(15, 23, 42)

  autoTable(doc, {
    startY: 94,
    theme: 'plain',
    body: [model.summary.map((item) => `${item.label}\n${item.value}`)],
    styles: { fontSize: 9, cellPadding: 8, lineColor: [226, 232, 240], lineWidth: 0.5, valign: 'middle' },
    columnStyles: {
      0: { fillColor: [248, 250, 252], halign: 'center' },
      1: { fillColor: [248, 250, 252], halign: 'center' },
      2: { fillColor: [248, 250, 252], halign: 'center' },
      3: { fillColor: [248, 250, 252], halign: 'center' },
    },
    margin: { left: 28, right: 28 },
  })

  const tableStartY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 94) + 16

  autoTable(doc, {
    startY: tableStartY,
    head: [model.columns],
    body: model.rows,
    styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak', valign: 'top', lineColor: [226, 232, 240], lineWidth: 0.3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 68 },
      2: { cellWidth: 56 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'right', cellWidth: 90 },
    },
    margin: { left: 28, right: 28 },
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight()
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text('Kapil Products | Generated from Kapil Pro', 28, pageHeight - 18)
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 28, pageHeight - 18, { align: 'right' })
      doc.setTextColor(15, 23, 42)
    },
  })

  return doc
}
