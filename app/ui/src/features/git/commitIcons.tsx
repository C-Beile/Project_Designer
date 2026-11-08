// Icons of the original commit dialog (reference shots 61, 62, 66): three toolbar glyphs above the
// tree, a blue folder, a plain document and a document with braces for JSON files.

const common = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export function ExpandAllIcon() {
  return (
    <svg {...common}>
      <path d="M4 16 16 4M10 4h6v6M4 10v6h6" />
    </svg>
  )
}

export function CollapseAllIcon() {
  return (
    <svg {...common}>
      <path d="M4 16 16 4M4 10h6v6M16 10h-6V4" />
    </svg>
  )
}

export function ListToggleIcon() {
  return (
    <svg {...common} strokeWidth={1.6}>
      <path d="M3 4h14v3H3zM7 9h10v3H7zM7 14h10v3H7z" />
    </svg>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} />
    </svg>
  )
}

export function FolderIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden>
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h4l1.5 1.5h7.5A1.5 1.5 0 0 1 17 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 1 12.5z" fill="#4d98ca" />
      <path d="M1 6h16v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 1 12.5z" fill="#93c4dc" />
    </svg>
  )
}

export function FileIcon({ json }: { json?: boolean }) {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
      <path d="M2.5 1.5h7l4 4v11h-11z" fill="#4a4a4a" stroke="#cfcfcf" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9.5 1.5v4h4" fill="none" stroke="#cfcfcf" strokeWidth="1" strokeLinejoin="round" />
      {json ? (
        <text x="8" y="13.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#e8e8e8" fontFamily="monospace">
          {'{}'}
        </text>
      ) : null}
    </svg>
  )
}
