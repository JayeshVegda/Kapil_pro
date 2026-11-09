/**
 * Unified chart palette & theme configuration for Kapil Billing dashboards.
 * Aligned with the executive blue identity (#2563eb) and semantic state mapping.
 */

export const CHART_THEME = {
  colors: {
    primary: '#2563eb', // blue-600 (sales, bought, wire out, our rate)
    secondary: '#059669', // emerald-600 (collections, paid out, metal in)
    benchmark: '#94a3b8', // slate-400 dashed (vilaity market benchmark)
    warning: '#f59e0b', // amber-500
    danger: '#e11d48', // rose-600
    neutral: '#64748b', // slate-500
    grid: '#f1f5f9', // slate-100
    axis: '#cbd5e1', // slate-300
    text: '#64748b', // slate-500
    blue: '#2563eb',
    emerald: '#059669',
  },
  ageing: {
    b0to30: '#3b82f6', // blue-500 (matching company-charts.tsx)
    b31to60: '#f59e0b', // amber-500
    b60plus: '#e11d48', // rose-600
  },
  donut: [
    '#2563eb', // blue-600 (primary)
    '#059669', // emerald-600 (secondary / healthy)
    '#3b82f6', // blue-500
    '#f59e0b', // amber-500
    '#64748b', // slate-500
    '#94a3b8', // slate-400
  ],
  typography: {
    fontSize: 11,
    fontFamily: 'inherit',
  },
  tooltipStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid #bfdbfe',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px -1px rgb(37 99 235 / 0.08)',
    fontSize: '11px',
    padding: '8px 12px',
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
} as const
