import { Icon, type IconSize, type IconWeight } from '../core/icons/Icon'
import type { IconName } from '../core/icons/icons'

// Tunnel state as a shape, not only a colour: empty circle = off, turning arc = connecting,
// half-filled circle = tunnel open, circle with check mark = connected, circle with cross = error.
// The colours (grey, yellow, green, red) stay as a second cue.

export type TunnelIconState = 'off' | 'connecting' | 'open' | 'on' | 'error'

const LOOK: Record<TunnelIconState, { name: IconName; weight: IconWeight; color: string; className?: string }> = {
  off: { name: 'circle', weight: 'regular', color: 'var(--fg-muted)' },
  connecting: { name: 'circle-notch', weight: 'bold', color: 'var(--warning)', className: 'tunnel-spin' },
  open: { name: 'circle-half', weight: 'regular', color: 'var(--warning)' },
  on: { name: 'check-circle', weight: 'fill', color: 'var(--success)' },
  error: { name: 'x-circle', weight: 'fill', color: 'var(--error)' },
}

export function TunnelStateIcon({ state, title, size = 'sm' }: { state: TunnelIconState | string; title?: string; size?: IconSize }) {
  const look = LOOK[state as TunnelIconState] ?? LOOK.off
  return (
    <span className="tunnel-dot" data-state={state} role="img" aria-label={title ?? state} title={title} style={{ display: 'inline-flex' }}>
      <Icon name={look.name} weight={look.weight} size={size} color={look.color} className={look.className} />
    </span>
  )
}
