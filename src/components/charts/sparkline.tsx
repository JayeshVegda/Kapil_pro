import { useId } from 'react'

export type SparklineProps = {
  values?: readonly number[]
  /** Explicit stroke color. If omitted, chosen based on `trend` or values slope. */
  color?: string
  /** 'up' = emerald green, 'down' = rose red, 'neutral' = slate */
  trend?: 'up' | 'down' | 'neutral'
  width?: number
  height?: number
  strokeWidth?: number
  showArea?: boolean
  className?: string
  id?: string
}

const TREND_PALETTES = {
  up: {
    stroke: '#059669', // emerald-600
    fill: '#10b981', // emerald-500
    dot: '#059669',
    halo: 'rgba(16, 185, 129, 0.22)',
  },
  down: {
    stroke: '#e11d48', // rose-600
    fill: '#f43f5e', // rose-500
    dot: '#e11d48',
    halo: 'rgba(244, 63, 94, 0.22)',
  },
  neutral: {
    stroke: '#64748b', // slate-500
    fill: '#94a3b8', // slate-400
    dot: '#64748b',
    halo: 'rgba(100, 116, 139, 0.20)',
  },
} as const

/**
 * Modern SVG sparkline with smooth cubic bezier spline, area gradient fill,
 * and state-driven emerald/rose color trajectory.
 */
export function Sparkline({
  values = [],
  color,
  trend,
  width = 120,
  height = 40,
  strokeWidth = 2,
  showArea = true,
  className,
  id,
}: SparklineProps) {
  const reactId = useId()
  const rawId = id || reactId
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const gradientId = `sparkline-grad-${cleanId}`

  if (!values || values.length < 2) return null

  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length < 2) return null

  // Determine trend direction if not explicitly supplied
  const resolvedTrend: 'up' | 'down' | 'neutral' =
    trend ??
    (valid[valid.length - 1] > valid[0]
      ? 'up'
      : valid[valid.length - 1] < valid[0]
        ? 'down'
        : 'neutral')

  const palette = TREND_PALETTES[resolvedTrend]
  const strokeColor = color ?? palette.stroke
  const fillColor = color ?? palette.fill
  const dotColor = color ?? palette.dot
  const haloColor = color ? `${color}33` : palette.halo

  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = max - min

  const paddingX = 4
  const paddingY = 4
  const innerWidth = width - paddingX * 2
  const innerHeight = height - paddingY * 2

  const points: Array<{ x: number; y: number }> = valid.map((v, i) => {
    const x = paddingX + (i / (valid.length - 1)) * innerWidth
    const y =
      range === 0
        ? paddingY + innerHeight / 2
        : paddingY + innerHeight - ((v - min) / range) * innerHeight
    return { x, y }
  })

  // Smooth Catmull-Rom to Cubic Bezier curve
  let curvePath = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const pPrev = points[Math.max(0, i - 1)]
    const pCurr = points[i]
    const pNext = points[i + 1]
    const pFuture = points[Math.min(points.length - 1, i + 2)]

    let cp1x = pCurr.x + (pNext.x - pPrev.x) / 6
    let cp1y = pCurr.y + (pNext.y - pPrev.y) / 6
    let cp2x = pNext.x - (pFuture.x - pCurr.x) / 6
    let cp2y = pNext.y - (pFuture.y - pCurr.y) / 6

    // Bound control points within inner vertical limits
    cp1y = Math.max(paddingY, Math.min(paddingY + innerHeight, cp1y))
    cp2y = Math.max(paddingY, Math.min(paddingY + innerHeight, cp2y))

    curvePath += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${pNext.x.toFixed(1)},${pNext.y.toFixed(1)}`
  }

  const lastPoint = points[points.length - 1]
  const areaPath = `${curvePath} L ${lastPoint.x.toFixed(1)},${height} L ${points[0].x.toFixed(1)},${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity={0.24} />
          <stop offset="100%" stopColor={fillColor} stopOpacity={0.0} />
        </linearGradient>
      </defs>

      {showArea && (
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
          className="transition-opacity duration-300"
        />
      )}

      <path
        d={curvePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End point dot with glow halo */}
      <circle cx={lastPoint.x} cy={lastPoint.y} r={strokeWidth + 2.5} fill={haloColor} />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={strokeWidth + 0.5}
        fill={dotColor}
        stroke="#ffffff"
        strokeWidth={1}
      />
    </svg>
  )
}
