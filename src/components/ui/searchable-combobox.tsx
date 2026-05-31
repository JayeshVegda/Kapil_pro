import { useEffect, useMemo, useRef, useState } from 'react'
import { filterRankedNameMatches } from '@/lib/search'

export type SearchableComboboxOption = {
  id: string
  name: string
}

type Props = {
  options: SearchableComboboxOption[]
  value: string
  onChange: (nextId: string) => void
  inputClassName: string
  placeholder?: string
  disabled?: boolean
  emptyText?: string
  maxResults?: number
}

export function SearchableCombobox({
  options,
  value,
  onChange,
  inputClassName,
  placeholder = 'Search...',
  disabled = false,
  emptyText = 'No matching results.',
  maxResults = 25,
}: Props) {
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const listboxId = useMemo(() => `combobox-${Math.random().toString(36).slice(2)}`, [])
  const previousValueRef = useRef(value)
  const previousSelectedNameRef = useRef('')
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const selected = useMemo(() => options.find((option) => option.id === value), [options, value])
  const selectedName = selected?.name ?? ''
  const matches = useMemo(
    () => filterRankedNameMatches(options, query, (option) => option.name).slice(0, maxResults),
    [options, query, maxResults],
  )

  useEffect(() => {
    const previousValue = previousValueRef.current
    const previousSelectedName = previousSelectedNameRef.current
    previousValueRef.current = value
    previousSelectedNameRef.current = selectedName
    if (!value && previousValue) {
      setQuery((current) => (current === previousSelectedName ? '' : current))
      return
    }
    if (!selectedName) return
    setQuery((current) => {
      if (value !== previousValue || !current || current === previousSelectedName) return selectedName
      return current
    })
  }, [selectedName, value])

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex(matches.length > 0 ? 0 : -1)
  }, [isOpen, matches])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [])

  function selectOption(nextId: string) {
    const nextOption = options.find((option) => option.id === nextId)
    if (nextOption) setQuery(nextOption.name)
    onChange(nextId)
    setIsOpen(false)
  }

  return (
    <div ref={pickerRef} className="relative">
      <input
        className={inputClassName}
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value
          setQuery(nextQuery)
          if (value && nextQuery !== selectedName) onChange('')
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!isOpen) {
              setIsOpen(true)
              return
            }
            if (matches.length === 0) return
            setActiveIndex((current) => (current + 1) % matches.length)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (!isOpen) {
              setIsOpen(true)
              return
            }
            if (matches.length === 0) return
            setActiveIndex((current) => (current <= 0 ? matches.length - 1 : current - 1))
            return
          }
          if (event.key === 'Enter') {
            if (!isOpen) return
            event.preventDefault()
            const match = matches[activeIndex] ?? matches[0]
            if (match) selectOption(match.id)
            return
          }
          if (event.key === 'Escape') {
            setIsOpen(false)
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
      />
      {isOpen && !disabled && (
        <div id={listboxId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">{emptyText}</div>}
          {matches.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                index === activeIndex || option.id === value ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700'
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option.id)}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
