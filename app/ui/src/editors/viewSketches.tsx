import type { ReactNode } from 'react'

// Small drawings of what a ViewTemplate looks like in the client. They follow the descriptions of
// the ViewTemplate reference (platform.help.adito.de/viewtemplates/); where the reference says
// nothing about the looks, the drawing is a neutral placeholder and says so. No live data.

export interface ChartSketchProps {
  type: string
}

const PIE_SLICES = [40, 25, 20, 15]
const PIE_COLORS = ['var(--accent)', 'var(--brand-link)', 'var(--fg-muted)', 'var(--border-strong)']

function Pie({ donut }: { donut: boolean }) {
  let offset = 0
  return (
    <svg viewBox="0 0 42 42" className="vp-chart-svg" role="img" aria-label={donut ? 'Donut chart' : 'Pie chart'}>
      {PIE_SLICES.map((share, i) => {
        const start = offset
        offset += share
        return (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={donut ? 15.9 : 8}
            fill="none"
            stroke={PIE_COLORS[i]}
            strokeWidth={donut ? 6 : 16}
            strokeDasharray={`${share} ${100 - share}`}
            strokeDashoffset={25 - start}
          />
        )
      })}
    </svg>
  )
}

function Funnel({ pyramid }: { pyramid: boolean }) {
  const levels = [100, 75, 50, 28]
  return (
    <svg viewBox="0 0 100 60" className="vp-chart-svg" role="img" aria-label={pyramid ? 'Pyramid chart' : 'Funnel chart'}>
      {levels.map((w, i) => {
        const width = pyramid ? levels[levels.length - 1 - i] : w
        const next = pyramid ? levels[levels.length - 2 - i] ?? 8 : (levels[i + 1] ?? 14)
        const top = i * 14 + 2
        const half = width / 2
        const nextHalf = next / 2
        return <polygon key={i} points={`${50 - half},${top} ${50 + half},${top} ${50 + nextHalf},${top + 12} ${50 - nextHalf},${top + 12}`} fill={PIE_COLORS[i]} />
      })}
    </svg>
  )
}

const BARS = [34, 52, 28, 46, 60]

function Bars({ horizontal }: { horizontal: boolean }) {
  return (
    <svg viewBox="0 0 100 60" className="vp-chart-svg" role="img" aria-label={horizontal ? 'Bar chart' : 'Column chart'}>
      {BARS.map((v, i) =>
        horizontal ? (
          <rect key={i} x="4" y={4 + i * 11} width={v} height="8" fill="var(--accent)" />
        ) : (
          <rect key={i} x={6 + i * 18} y={56 - v} width="12" height={v} fill="var(--accent)" />
        ),
      )}
    </svg>
  )
}

function Line({ area, smooth }: { area: boolean; smooth: boolean }) {
  const points = BARS.map((v, i) => [6 + i * 22, 56 - v] as const)
  const path = smooth
    ? `M${points[0][0]},${points[0][1]} ` + points.slice(1).map(([x, y], i) => `Q${(points[i][0] + x) / 2},${Math.min(points[i][1], y) - 6} ${x},${y}`).join(' ')
    : `M${points.map(([x, y]) => `${x},${y}`).join(' L')}`
  return (
    <svg viewBox="0 0 100 60" className="vp-chart-svg" role="img" aria-label={area ? 'Area chart' : smooth ? 'Spline chart' : 'Line chart'}>
      {area ? <path d={`${path} L${points[points.length - 1][0]},56 L${points[0][0]},56 Z`} fill="var(--accent)" opacity="0.35" /> : null}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  )
}

/** Chart type as the model stores it (PIE, DONUT, FUNNEL, PYRAMID, COLUMN, BAR, LINE, SPLINE, AREA). */
export function ChartSketch({ type }: ChartSketchProps) {
  switch (type.toUpperCase()) {
    case 'PIE':
      return <Pie donut={false} />
    case 'DONUT':
      return <Pie donut />
    case 'FUNNEL':
      return <Funnel pyramid={false} />
    case 'PYRAMID':
      return <Funnel pyramid />
    case 'BAR':
      return <Bars horizontal />
    case 'LINE':
      return <Line area={false} smooth={false} />
    case 'SPLINE':
      return <Line area={false} smooth />
    case 'AREA':
      return <Line area smooth={false} />
    default:
      return <Bars horizontal={false} />
  }
}

export function MapSketch({ markers }: { markers: number }) {
  return (
    <div className="vp-map" role="img" aria-label="Map with markers">
      {Array.from({ length: markers }, (_, i) => (
        <span key={i} className="vp-marker" style={{ left: `${20 + i * 25}%`, top: `${30 + ((i * 37) % 40)}%` }} />
      ))}
    </div>
  )
}

export function Steps({ labels }: { labels: string[] }) {
  return (
    <ol className="vp-stepper" aria-label="Steps">
      {labels.map((label, i) => (
        <li key={label} className={i === 0 ? 'is-active' : ''}>
          <span className="vp-step-no">{i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}

export function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="vp-placeholder" role="note">
      <strong>{title}</strong>
      {children ? <div className="vp-muted">{children}</div> : null}
    </div>
  )
}
