import { useEffect, useState } from 'react'
import { formatFullDate, parseSmartDate } from '@/lib/date'

type Props = {
  value: string
  onChange: (nextIsoDate: string) => void
  className: string
  disabled?: boolean
}

export function DateInput({ value, onChange, className, disabled = false }: Props) {
  const [display, setDisplay] = useState(() => formatFullDate(value))

  useEffect(() => {
    setDisplay(formatFullDate(value))
  }, [value])

  function commit(nextDisplay = display) {
    // Smart entry: "13" = 13th this month, "1-31" = 31 Jan, "13-6-25" = 13-06-2025.
    const parsed = parseSmartDate(nextDisplay)
    if (parsed) {
      onChange(parsed)
      setDisplay(formatFullDate(parsed))
      return
    }
    if (!nextDisplay.trim()) {
      onChange('')
      setDisplay('')
      return
    }
    setDisplay(formatFullDate(value))
  }

  return (
    <input
      className={className}
      value={display}
      onChange={(event) => setDisplay(event.target.value)}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
      placeholder="13 · 13-6 · 13-6-25"
      inputMode="numeric"
      disabled={disabled}
    />
  )
}
