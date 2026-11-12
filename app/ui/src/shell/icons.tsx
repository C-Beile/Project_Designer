import type { ReactNode } from 'react'

// Forge's own toolbar/panel icons, drawn in the shape language of the original Designer's
// toolbar (folder, disk, circular arrow, play triangle, ...) but not copied from it. Colors come
// only from theme tokens.

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
      {children}
    </svg>
  )
}

export const IconOpenProject = () => (
  <Svg>
    <path d="M1.5 4.5h4l1.2 1.4h7.8v7.6h-13z" fill="var(--icon-folder)" fillOpacity="0.35" stroke="var(--icon-folder)" />
    <path d="M10.5 1.5v4M8.6 3.6l1.9 1.9 1.9-1.9" stroke="var(--accent)" />
  </Svg>
)

export const IconSave = () => (
  <Svg>
    <path d="M2.5 2.5h9l2 2v9h-11z" stroke="var(--accent)" />
    <path d="M5 2.5v3.5h5V2.5M4.5 13.5v-4h7v4" stroke="var(--accent)" />
  </Svg>
)

export const IconSaveAll = () => (
  <Svg>
    <path d="M4.5 1.5h8l2 2v8" stroke="var(--accent)" />
    <path d="M1.5 4.5h8l2 2v8h-10z" stroke="var(--accent)" />
    <path d="M3.5 14.5v-3.5h6v3.5" stroke="var(--accent)" />
  </Svg>
)

export const IconRefresh = () => (
  <Svg>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" stroke="var(--cyan)" />
    <path d="M12 1.8v2.9H9.1" stroke="var(--cyan)" />
  </Svg>
)

export const IconBack = () => (
  <Svg>
    <path d="M13.5 8h-11M6.5 4 2.5 8l4 4" />
  </Svg>
)

export const IconForward = () => (
  <Svg>
    <path d="M2.5 8h11M9.5 4l4 4-4 4" />
  </Svg>
)

export const IconUndo = () => (
  <Svg>
    <path d="M5 3.5 2 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-3" />
  </Svg>
)

export const IconRedo = () => (
  <Svg>
    <path d="M11 3.5l3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8h3" />
  </Svg>
)

export const IconRun = () => (
  <Svg>
    <path d="M4 2.5v11l9-5.5z" fill="var(--success)" stroke="var(--success)" />
  </Svg>
)

export const IconDeploy = () => (
  <Svg>
    <path d="M3.5 12.5h9M8 2.5v7.5M4.8 6.8 8 10l3.2-3.2" stroke="var(--accent-2)" />
  </Svg>
)

export const IconTranspile = () => (
  <Svg>
    <path d="M2.5 4.5h4l1.5 1.5-1.5 1.5h-4zM9.5 8.5h4v3h-4z" stroke="var(--warm)" />
    <path d="M8 6h3.5v2.5" stroke="var(--warm)" />
  </Svg>
)

export const IconClose = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" focusable="false">
    <path d="M1 1l7 7M8 1 1 8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const IconMinimize = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" focusable="false">
    <path d="M6.5 1 3 4.5 6.5 8" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
)

export const IconNew = () => (
  <Svg>
    <path d="M3.5 1.5h6l3 3v10h-9z" stroke="var(--accent)" />
    <path d="M9.5 1.5v3h3M8 7v4M6 9h4" stroke="var(--success)" />
  </Svg>
)

export const IconOpenModel = () => (
  <Svg>
    <path d="M3.5 1.5h6l3 3v10h-9z" stroke="var(--accent)" />
    <circle cx="7.5" cy="9" r="2.2" stroke="var(--cyan)" />
    <path d="m9.2 10.7 2 2" stroke="var(--cyan)" />
  </Svg>
)

export const IconCommit = () => (
  <Svg>
    <path d="M3 8.5 6.5 12 13 4.5" stroke="var(--success)" />
  </Svg>
)

export const IconPull = () => (
  <Svg>
    <path d="M3.5 3.5 8 8l4.5-4.5M3.5 8 8 12.5 12.5 8" stroke="var(--accent)" />
  </Svg>
)

export const IconPush = () => (
  <Svg>
    <path d="M3.5 12.5 8 8l4.5 4.5M3.5 8 8 3.5 12.5 8" stroke="var(--accent)" />
  </Svg>
)

export const IconDiff = () => (
  <Svg>
    <path d="M2 3.5h5v9H2zM9 3.5h5v9H9z" stroke="var(--accent)" />
    <path d="M3.5 6h2M10.5 9h2" stroke="var(--warm)" />
  </Svg>
)

export const IconHistory = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" stroke="var(--accent)" />
    <path d="M8 4.8V8l2.2 1.4" stroke="var(--accent)" />
  </Svg>
)

export const IconLocalChanges = () => (
  <Svg>
    <path d="M3.5 1.5h6l3 3v10h-9z" stroke="var(--accent)" />
    <path d="M6 8h4M6 10.5h4" stroke="var(--warm)" />
  </Svg>
)

export const IconDeployOpened = () => (
  <Svg>
    <path d="M3.5 12.5h9M8 2.5v7.5M4.8 6.8 8 10l3.2-3.2" stroke="var(--accent-2)" />
    <path d="M13.5 2v3M12 3.5h3" stroke="var(--success)" />
  </Svg>
)

export const IconSql = () => (
  <Svg>
    <ellipse cx="8" cy="4" rx="4.5" ry="1.8" stroke="var(--cyan)" />
    <path d="M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" stroke="var(--cyan)" />
  </Svg>
)

export const IconRest = () => (
  <Svg>
    <path d="M2.5 8h11M10 4.5 13.5 8 10 11.5" stroke="var(--success)" />
    <path d="M6 4.5 2.5 8 6 11.5" stroke="var(--warning)" />
  </Svg>
)

export const IconDependencies = () => (
  <Svg>
    <circle cx="4" cy="4" r="1.8" stroke="var(--accent)" />
    <circle cx="12" cy="12" r="1.8" stroke="var(--accent)" />
    <circle cx="12" cy="4" r="1.8" stroke="var(--accent)" />
    <path d="M5.6 4.4 10.4 4M4.8 5.6 11 10.6" />
  </Svg>
)

export const IconBug = () => (
  <Svg>
    <ellipse cx="8" cy="9" rx="3" ry="4" stroke="var(--cyan)" />
    <path d="M5 7 2.5 5.5M11 7l2.5-1.5M5 10.5H2.5M11 10.5h2.5M6.5 3.5 5.5 2M9.5 3.5l1-1.5" />
  </Svg>
)

export const IconExtensionPack = () => (
  <Svg>
    <path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z" stroke="var(--accent)" />
    <path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5" />
  </Svg>
)

export const IconFind = () => (
  <Svg>
    <circle cx="6.5" cy="6.5" r="4" stroke="var(--accent)" />
    <path d="m9.6 9.6 4 4" stroke="var(--accent)" />
  </Svg>
)
