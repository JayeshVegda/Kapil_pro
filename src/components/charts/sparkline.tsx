export type SparklineProps = {
  values?: readonly number[]
  color?: string
  width?: number
  height?: number
  className?: string
}

/**
 * Lightweight, zero-dependency SVG sparkline for KPI tiles.
 * Invariant: Hides completely when there are fewer than 2 data points.
 */
export function Sparkline({
  values = [],
  color = '#1e293b',
  width = 64,
  height = 20,
  className,
}: SparklineProps) {
  if (!values || values.length < 2) return null

  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length < 2) return null

  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = max - min || 1
  const padding = 2
  const innerHeight = height - padding * 2
  const innerWidth = width - padding * 2

  const points = valid
    .map((v, i) => {
      const x = padding + (i / (valid.length - 1)) * innerWidth
      const y = padding + innerHeight - ((v - min) / range) * innerHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const lastValue = valid[valid.length - 1]
  const lastY = padding + innerHeight - ((lastValue - min) / range) * innerHeight
  const lastX = padding + innerWidth

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  )
}
