import type { ReactNode } from 'react'

// Icons of the alias config list (original Designer: gear for the instance configuration, disc stack
// for databases, server rack for mail/cluster/workflow, envelope for repositories, calendar for
// Exchange, key for authentication, globe for index search, document otherwise).

const SHAPES: Record<string, ReactNode> = {
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5l1.6 2.6 3-.7.7 3 2.7 1.5-1.2 2.8 1.2 2.8-2.7 1.5-.7 3-3-.7L12 21.5l-1.6-2.6-3 .7-.7-3-2.7-1.5 1.2-2.8-1.2-2.8 2.7-1.5.7-3 3 .7z" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6" />
      <path d="M5 12v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-6" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="3.5" width="16" height="6" rx="1.2" />
      <rect x="4" y="14.5" width="16" height="6" rx="1.2" />
      <path d="M7.5 6.5h.01M7.5 17.5h.01M11 6.5h6M11 17.5h6M12 9.5v5" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h.01M8 17h2M12 17h2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5L19 4M16 7l2.5 2.5M13.5 9.5L16 12" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
}

export function AliasIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  return (
    <svg
      className={`alias-icon alias-icon-${icon}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[icon] ?? SHAPES.file}
    </svg>
  )
}
