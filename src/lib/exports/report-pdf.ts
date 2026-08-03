import { createStyledPdf } from '@/lib/exports/pdf-engine'
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

export async function createPartyStatementPdf(viewModel: PartyStatementViewModel) {
  const model = buildPartyStatementPdfModel(viewModel)
  return createStyledPdf({
    title: model.title,
    subtitle: model.subtitle,
    summary: model.summary,
    orientation: 'portrait',
    sections: [
      {
        kind: 'table',
        // Statement columns: Date, Type, Ref, Debit, Credit, Balance (+ Details).
        columns: model.columns.map((header) => ({
          header,
          align: /debit|credit|balance|amount/i.test(header) ? ('right' as const) : ('left' as const),
          ...(/^date$/i.test(header) ? { width: 62 } : {}),
          ...(/^type$/i.test(header) ? { width: 48 } : {}),
        })),
        rows: model.rows,
      },
    ],
  })
}
