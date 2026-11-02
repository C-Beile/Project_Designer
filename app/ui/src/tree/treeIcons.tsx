import type { ReactNode } from 'react'
import type { TreeNode } from '../wire/types'

// Own 16 px icons in the shape/colour scheme of the original Designer's Projects tree
// (LAYOUT_SPEC §4.4); colours come only from tokens.css.

const S = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const

function FolderIcon({ type, open }: { type: string; open: boolean }) {
  const fill = `var(--folder-${type}, var(--folder-plain))`
  return open ? (
    <svg {...S}>
      <path d="M1 3.5h5l1.5 1.5H14v2H4.2L1 13z" fill={fill} opacity="0.75" />
      <path d="M3.8 7.5H15.5L12.5 13.5H1z" fill={fill} />
    </svg>
  ) : (
    <svg {...S}>
      <path d="M1 3h5l1.5 1.5H15v9H1z" fill={fill} />
      <path d="M1 6h14" stroke="var(--bg)" strokeOpacity="0.25" />
    </svg>
  )
}

function ProjectIcon() {
  return (
    <svg {...S}>
      <path d="M2 14L8 2l2.6 5.2L7 14z" fill="var(--project-icon-a)" />
      <path d="M8.4 10.5L10.8 7.6 14 14H9.8z" fill="var(--project-icon-b)" />
    </svg>
  )
}

function LibrariesIcon() {
  return (
    <svg {...S}>
      <path d="M5 1.5l3 1.6v3.3L5 8 2 6.4V3.1z" fill="var(--folder-system)" />
      <path d="M11 1.5l3 1.6v3.3L11 8 8 6.4V3.1z" fill="var(--folder-system)" opacity="0.75" />
      <path d="M8 8l3 1.6v3.3L8 14.5 5 12.9V9.6z" fill="var(--folder-system)" opacity="0.9" />
    </svg>
  )
}

function Sheet({ accent, children }: { accent?: string; children?: ReactNode }) {
  return (
    <svg {...S}>
      <path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="var(--fg-muted)" />
      <path d="M9.5 1.5V5H13" fill="none" stroke="var(--fg-muted)" />
      {accent ? <path d="M3.5 13h9" stroke={accent} strokeWidth="2" /> : null}
      {children}
    </svg>
  )
}

function TextBadge({ text }: { text: string }) {
  return (
    <svg {...S}>
      <text x="8" y="12" textAnchor="middle" fontSize={text.length > 2 ? 7 : 10} fontWeight="700" fill="var(--accent)">
        {text}
      </text>
    </svg>
  )
}

function fileIcon(label: string) {
  const lower = label.toLowerCase()
  if (lower.endsWith('.json')) return <TextBadge text="{}" />
  if (lower.endsWith('.md')) return <TextBadge text="M↓" />
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return <Sheet accent="var(--folder-application)" />
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return <Sheet accent="var(--warm)" />
  return <Sheet />
}

function objectIcon(objectType: string | null) {
  switch (objectType) {
    case 'neonView':
      return (
        <svg {...S}>
          <rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="var(--fg-muted)" />
          <path d="M1.5 5.5h13" stroke="var(--fg-muted)" />
        </svg>
      )
    case 'entity':
      return <Sheet accent="var(--folder-entity)" />
    case 'neonContext':
      return <Sheet accent="var(--folder-context)" />
    case 'process':
      return <Sheet accent="var(--folder-process)" />
    case 'system':
      return <Sheet accent="var(--folder-system)" />
    case 'aliasDefinition':
      return <Sheet accent="var(--folder-alias)" />
    case 'serviceDefinition':
    case 'entityWebservice':
      return <Sheet accent="var(--folder-service)" />
    default:
      return <Sheet />
  }
}

export function NodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  switch (node.kind) {
    case 'project':
    case 'module':
      return <ProjectIcon />
    case 'libraries':
      return <LibrariesIcon />
    case 'file':
      return fileIcon(node.label)
    case 'dir':
      return <FolderIcon type="plain" open={expanded} />
    case 'object':
      return objectIcon(node.object_type)
    default:
      if (node.object_type) return objectIcon(node.object_type)
      return <FolderIcon type={node.folder ?? 'plain'} open={expanded} />
  }
}

export { ProjectIcon }
