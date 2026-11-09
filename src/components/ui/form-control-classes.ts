/** Shared visual contract for editable form controls. */
export const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30 disabled:cursor-not-allowed disabled:opacity-50'
export const selectClass = inputClass
export const textareaClass = `${inputClass} min-h-16 py-2`

/** Shared visual contract for standard button styles. */
export function buttonClass(variant: 'primary' | 'secondary' | 'danger' = 'primary') {
  if (variant === 'secondary') {
    return 'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
  }
  if (variant === 'danger') {
    return 'inline-flex items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60'
  }
  return 'inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
}

