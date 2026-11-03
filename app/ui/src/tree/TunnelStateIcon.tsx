// Tunnel state as a shape, not only a colour: empty ring = off, turning arc = connecting,
// half-filled circle = tunnel open, circle with check mark = connected, triangle with cross = error.
// The colours (grey, yellow, green, red) stay as a second cue.

export type TunnelIconState = 'off' | 'connecting' | 'open' | 'on' | 'error'

export function TunnelStateIcon({ state, title, size = 12 }: { state: TunnelIconState | string; title?: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 12 12', className: 'tunnel-dot', 'data-state': state, role: 'img', 'aria-label': title ?? state } as const
  switch (state) {
    case 'connecting':
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--warning)" strokeOpacity="0.35" strokeWidth="1.6" />
          <path className="tunnel-spin" d="M6 1.8a4.2 4.2 0 0 1 4.2 4.2" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'open':
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--warning)" strokeWidth="1.4" />
          <path d="M6 1.6a4.4 4.4 0 0 0 0 8.8z" fill="var(--warning)" />
        </svg>
      )
    case 'on':
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="6" cy="6" r="5.2" fill="var(--success, #3fb950)" />
          <path d="M3.4 6.2l1.8 1.9 3.5-4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'error':
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M6 1l5.2 9.4H.8z" fill="var(--error)" />
          <path d="M4.6 5.4l2.8 2.8M7.4 5.4L4.6 8.2" stroke="var(--bg)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--fg-muted)" strokeWidth="1.4" />
          <path d="M3.9 6h4.2" stroke="var(--fg-muted)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )
  }
}
