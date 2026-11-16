/**
 * Unified chart palette & theme configuration for Kapil Billing dashboards.
 * Strictly aligned with Kapil design tokens: calm surfaces, slate dividers,
 * semantic color map, and accessible contrast.
 */

export const CHART_THEME = {
  colors: {
    primary: '#0f172a', // slate-900
    secondary: '#2563eb', // shared chart fallback
    sales: '#2563eb', // blue-600 (sales billed)
    collections: '#059669', // emerald-600 (collections received)
    purchases: '#d97706', // amber-600 (scrap bought)
    payouts: '#64748b', // slate-500 (disbursed out)
    benchmark: '#94a3b8', // slate-400 dashed (vilaity market benchmark)
    warning: '#d97706', // amber-600
    danger: '#e11d48', // rose-600
    neutral: '#64748b', // slate-500
    grid: '#f1f5f9', // slate-100
    axis: '#cbd5e1', // slate-300
    text: '#64748b', // slate-500
    blue: '#2563eb',
    emerald: '#059669',
  },
  ageing: {
    b0to30: '#3b82f6', // blue-500 (current receivables)
    b31to60: '#d97706', // amber-600 (watch period)
    b60plus: '#e11d48', // rose-600 (overdue risk)
  },
  donut: [
    '#0f172a', // slate-900
    '#2563eb', // blue-600
    '#059669', // emerald-600
    '#d97706', // amber-600
    '#64748b', // slate-500
    '#94a3b8', // slate-400
  ],
  typography: {
    fontSize: 11,
    fontFamily: 'inherit',
  },
  tooltipStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px -1px rgb(15 23 42 / 0.08)',
    fontSize: '11px',
    padding: '8px 12px',
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
} as const
