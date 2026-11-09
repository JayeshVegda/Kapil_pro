/**
 * Unified chart palette & theme configuration for Kapil Billing dashboards.
 * Invariant: Never use blue for chart series. Blue is strictly for selection/UI states.
 */

export const CHART_THEME = {
  colors: {
    primary: '#1e293b', // slate-800
    secondary: '#059669', // emerald-600
    benchmark: '#94a3b8', // slate-400 dashed
    warning: '#f59e0b', // amber-500
    danger: '#f43f5e', // rose-500
    neutral: '#64748b', // slate-500
    grid: '#f1f5f9', // slate-100
    axis: '#cbd5e1', // slate-300
    text: '#64748b', // slate-500
  },
  ageing: {
    b0to30: '#cbd5e1', // slate-300
    b31to60: '#fbbf24', // amber-400
    b60plus: '#f43f5e', // rose-500
  },
  donut: [
    '#059669', // emerald-600 (primary positive / top slice)
    '#334155', // slate-700
    '#475569', // slate-600
    '#64748b', // slate-500
    '#94a3b8', // slate-400
    '#cbd5e1', // slate-300 (other / tail)
  ],
  typography: {
    fontSize: 11,
    fontFamily: 'inherit',
  },
  tooltipStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    fontSize: '11px',
    padding: '8px 12px',
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
} as const
