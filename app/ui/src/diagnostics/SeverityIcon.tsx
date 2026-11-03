// Severity as a shape, not only a colour: circle with a cross = error, triangle with an
// exclamation mark = warning, circle with an "i" = information.

export function SeverityIcon({ severity, size = 14 }: { severity: 'Error' | 'Warning' | 'Info'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true } as const
  if (severity === 'Error') {
    return (
      <svg {...p}>
        <circle cx="8" cy="8" r="7" fill="var(--error)" />
        <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
  if (severity === 'Warning') {
    return (
      <svg {...p}>
        <path d="M8 1.4l7 12.4H1z" fill="var(--warning)" stroke="var(--warning)" strokeWidth="1" strokeLinejoin="round" />
        <path d="M8 6v3.6" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="0.95" fill="var(--bg)" />
      </svg>
    )
  }
  return (
    <svg {...p}>
      <circle cx="8" cy="8" r="7" fill="var(--accent)" />
      <path d="M8 7.2v4.2" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.95" fill="var(--bg)" />
    </svg>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="forge-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
      <path d="M3 1.5L7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
