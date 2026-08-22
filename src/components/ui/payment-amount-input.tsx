import { IndianRupee } from 'lucide-react'
import { useEffect, useId, useState, type Ref } from 'react'
import { formatInrInteger, parseBillQuickPaymentAmountInput } from '@/lib/inr-format'

type PaymentAmountInputProps = {
  value: number
  onChange: (value: number) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onInputChange?: () => void
  inputRef?: Ref<HTMLInputElement>
  onEnter?: () => void
}

export function PaymentAmountInput({
  value,
  onChange,
  className = '',
  placeholder = '350, 3.5l, 50k',
  disabled,
  autoFocus,
  onInputChange,
  inputRef,
  onEnter,
}: PaymentAmountInputProps) {
  const interpretationId = useId()
  const [rawValue, setRawValue] = useState(() => value > 0 ? formatInputValue(value) : '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setRawValue(value > 0 ? formatInputValue(value) : '')
  }, [value, focused])

  const interpreted = parseBillQuickPaymentAmountInput(rawValue)
  const showInterpretation = focused && rawValue.trim() !== '' && interpreted > 0

  return (
    <div className="relative">
      <div className="relative">
        <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          className={`${className} pl-8 font-mono tabular-nums`}
          type="text"
          inputMode="decimal"
          value={rawValue}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            const next = event.target.value
            setRawValue(next)
            onChange(parseBillQuickPaymentAmountInput(next))
            onInputChange?.()
          }}
          onBlur={() => {
            setFocused(false)
            if (interpreted > 0) setRawValue(formatInputValue(interpreted))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) {
              event.preventDefault()
              onEnter()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={showInterpretation ? interpretationId : undefined}
        />
      </div>
      {showInterpretation && (
        <span
          id={interpretationId}
          className="pointer-events-none absolute right-1 top-full z-10 mt-0.5 whitespace-nowrap text-[10px] leading-3 text-slate-400"
          aria-live="polite"
        >
          = {formatInrInteger(interpreted)}
        </span>
      )}
    </div>
  )
}

function formatInputValue(value: number): string {
  return formatInrInteger(value).replace('₹', '')
}
