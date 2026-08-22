import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { loadBookRegister } from '@/data/bills'
import { BILL_BOOK_SIZE } from '@/domain/bill-books'

export const BOOK_REGISTER_QUERY_KEY = ['book-register'] as const

export function BookRegisterPanel() {
  const registerQuery = useQuery({
    queryKey: BOOK_REGISTER_QUERY_KEY,
    queryFn: loadBookRegister,
  })

  const books = registerQuery.data?.books ?? []
  const totalSkipped = books.reduce((sum, book) => sum + book.skippedBillNos.length, 0)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <BookOpen size={15} className="text-slate-400" />
            Book Register
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Each book holds {BILL_BOOK_SIZE} bills starting at its book number. Skipped numbers are torn or cancelled pages — shown for reference, never reused.
          </p>
        </div>
        {totalSkipped > 0 && (
          <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
            {totalSkipped} skipped number{totalSkipped === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {registerQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Reading bill books...</p>}
      {registerQuery.isError && <p className="mt-4 text-sm text-red-600">Unable to read the book register.</p>}

      {!registerQuery.isLoading && !registerQuery.isError && books.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No bills recorded yet.</p>
      )}

      {books.length > 0 && (
        <div className="mt-4 overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-slate-50">
                <Th>Book</Th>
                <Th>Range</Th>
                <Th align="right">Used</Th>
                <Th align="right">Remaining</Th>
                <Th>Skipped numbers</Th>
                <Th align="right">Next</Th>
              </tr>
            </thead>
            <tbody>
              {books.map((book, index) => (
                <tr key={book.bookNo} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                  <td className="px-3 py-3 text-sm font-semibold tabular-nums text-slate-900">{book.bookNo}</td>
                  <td className="px-3 py-3 text-sm tabular-nums text-slate-600">
                    {book.firstBillNo}–{book.lastBillNo}
                  </td>
                  <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-900">{book.usedCount}</td>
                  <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-600">
                    {book.isComplete ? <span className="text-slate-400">Full</span> : book.remainingCount}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {book.skippedBillNos.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {book.skippedBillNos.map((billNo) => (
                          <span key={billNo} className="rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200">
                            {billNo}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-900">
                    {book.nextBillNo ?? <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  // Tailwind cannot see interpolated class names, so both variants are spelled out.
  const alignClass = align === 'right' ? 'text-right' : 'text-left'
  return <th className={`px-3 py-2 ${alignClass} text-xs font-semibold uppercase tracking-[0.08em] text-slate-500`}>{children}</th>
}
