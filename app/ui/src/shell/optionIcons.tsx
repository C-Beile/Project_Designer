// Own line icons for the Options categories (one drawing style, no emoji that look different on
// every system). Colour comes from the surrounding text colour.

const base = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export function OptionIcon({ id }: { id: string }) {
  switch (id) {
    case 'general':
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="3.2" />
          <circle cx="12" cy="12" r="7.6" strokeDasharray="2.6 2.4" strokeWidth="2.4" />
        </svg>
      )
    case 'editor':
      return (
        <svg {...base}>
          <path d="M4 20l1-4.2L16 4.8a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8.2 19z" />
          <path d="M14 7l3 3" />
        </svg>
      )
    case 'fonts':
      return (
        <svg {...base}>
          <path d="M3.5 17l4-10 4 10M5 13.5h5" />
          <path d="M14 17l2.8-6.5L19.6 17M15 15h3.6" />
          <path d="M3.5 20.5h17" strokeWidth="2.2" />
        </svg>
      )
    case 'keymap':
      return (
        <svg {...base}>
          <rect x="3" y="6.5" width="18" height="11" rx="2" />
          <path d="M7 10.2h.01M10 10.2h.01M13 10.2h.01M16 10.2h.01M7.5 14h9" strokeWidth="2" />
        </svg>
      )
    case 'team':
      return (
        <svg {...base}>
          <circle cx="9" cy="8.6" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="8" r="2.4" />
          <path d="M16.2 13.2a4.6 4.6 0 0 1 4.6 4.4" />
        </svg>
      )
    case 'appearance':
      return (
        <svg {...base}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </svg>
      )
    case 'misc':
      return (
        <svg {...base}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
        </svg>
      )
    case 'adito':
      return (
        <svg {...base}>
          <path d="M3.5 20L11 4l3.2 6.6L9.4 20z" />
          <path d="M13.2 16.4l3-3.6L20.5 20h-5.6z" />
        </svg>
      )
    case 'ireport':
      return (
        <svg {...base}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9.2 17.5v-3M12 17.5v-5.5M14.8 17.5v-2.2" />
        </svg>
      )
    default:
      return null
  }
}

export function PluginStateIcon({ state }: { state: 'active' | 'deactivated' | 'missing' }) {
  const p = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  if (state === 'active') {
    return (
      <svg {...p} stroke="none">
        <circle cx="8" cy="8" r="7" fill="var(--success)" />
        <path d="M4.6 8.2l2.3 2.3 4.5-5" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'deactivated') {
    return (
      <svg {...p}>
        <circle cx="8" cy="8" r="6.3" stroke="var(--warning)" />
        <path d="M6.2 5.6v4.8M9.8 5.6v4.8" stroke="var(--warning)" strokeWidth="1.8" />
      </svg>
    )
  }
  return (
    <svg {...p}>
      <circle cx="8" cy="8" r="6.3" stroke="var(--fg-muted)" strokeDasharray="2.2 2" />
    </svg>
  )
}
