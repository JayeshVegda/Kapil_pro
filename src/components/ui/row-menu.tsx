import { useEffect, useRef, useState, type ReactNode } from 'react'

export type RowMenuItem = {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/** Compact "⋯" row action menu. Closes on outside click / Escape. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label ?? 'Row actions'}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full px-3 py-1.5 text-left transition disabled:opacity-40 ${
                item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MenuSection({ children }: { children: ReactNode }) {
  return <div className="border-t border-slate-100 first:border-t-0">{children}</div>
}
