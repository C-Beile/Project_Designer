import type { ReactNode } from 'react'
import type { TreeNode } from '../wire/types'

// Own 16 px icons in the shape/colour scheme of the original Designer's Projects tree
// (LAYOUT_SPEC §4.4); colours come only from tokens.css.

const S = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const


// One small symbol per kind of folder or object, drawn in a 6 x 5 px box at the middle of the 16 px
// icon, so kinds differ by shape and not only by colour.
function Glyph({ type, color }: { type: string; color: string }) {
  const line = { fill: 'none', stroke: color, strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  switch (type) {
    case 'system':
      return (
        <g>
          <circle cx="8" cy="9.5" r="2.2" {...line} />
          <circle cx="8" cy="9.5" r="0.7" fill={color} />
        </g>
      )
    case 'preferences':
      return (
        <g>
          <path d="M5 8.2h6M5 10.8h6" {...line} />
          <circle cx="7" cy="8.2" r="1" fill={color} />
          <circle cx="9.6" cy="10.8" r="1" fill={color} />
        </g>
      )
    case 'application':
      return (
        <g fill={color}>
          <rect x="5" y="7.2" width="2.6" height="2.2" />
          <rect x="8.4" y="7.2" width="2.6" height="2.2" />
          <rect x="5" y="10" width="2.6" height="2.2" />
          <rect x="8.4" y="10" width="2.6" height="2.2" />
        </g>
      )
    case 'context':
      return <circle cx="8" cy="9.6" r="2.4" fill={color} />
    case 'notificationtype':
      return <path d="M6.2 10.6V9.2a1.8 1.8 0 0 1 3.6 0v1.4M5.6 10.6h4.8M7.3 12h1.4" {...line} />
    case 'entity':
      return <path d="M5 7.4h6v4.8H5zM5 9h6M8 9v3.2" {...line} strokeWidth={1} />
    case 'dashboard':
      return <path d="M5.6 12.2v-2M8 12.2v-4.2M10.4 12.2v-3" {...line} strokeWidth={1.8} strokeLinecap="butt" />
    case 'renderer':
      return <path d="M6.4 7.4l4.2 2.4-4.2 2.4z" fill={color} />
    case 'process':
      return <path d="M5.2 9.7h5M8.6 7.5l2.2 2.2-2.2 2.2" {...line} />
    case 'test':
      return <path d="M5.4 9.8l1.9 2 3.4-4.2" {...line} strokeWidth={1.6} />
    case 'service':
      return <path d="M8.9 6.9L6 10.1h2.1l-.9 2.4 3-3.3H8z" fill={color} />
    case 'report':
      return <path d="M5.4 7.7h5.2M5.4 9.6h5.2M5.4 11.5h3" {...line} />
    case 'language':
      return (
        <text x="8" y="12" textAnchor="middle" fontSize="7.5" fontWeight="700" fill={color}>
          A
        </text>
      )
    case 'role':
      return (
        <g fill={color}>
          <circle cx="8" cy="8.3" r="1.4" />
          <path d="M5.5 12.3a2.5 2.5 0 0 1 5 0z" />
        </g>
      )
    case 'alias':
      return (
        <g {...line}>
          <circle cx="6.7" cy="9.6" r="1.8" />
          <circle cx="9.3" cy="9.6" r="1.8" />
        </g>
      )
    case 'others':
      return (
        <g fill={color}>
          <circle cx="5.8" cy="9.6" r="0.95" />
          <circle cx="8" cy="9.6" r="0.95" />
          <circle cx="10.2" cy="9.6" r="0.95" />
        </g>
      )
    default:
      return null
  }
}

function FolderIcon({ type, open }: { type: string; open: boolean }) {
  const fill = `var(--folder-${type}, var(--folder-plain))`
  return open ? (
    <svg {...S}>
      <path d="M1 3.5h5l1.5 1.5H14v2H4.2L1 13z" fill={fill} opacity="0.75" />
      <path d="M3.8 7.5H15.5L12.5 13.5H1z" fill={fill} />
      <g transform="translate(1 0.6)">
        <Glyph type={type} color="var(--bg)" />
      </g>
    </svg>
  ) : (
    <svg {...S}>
      <path d="M1 3h5l1.5 1.5H15v9H1z" fill={fill} />
      <path d="M1 6h14" stroke="var(--bg)" strokeOpacity="0.25" />
      <Glyph type={type} color="var(--bg)" />
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

function Sheet({ accent, glyph, children }: { accent?: string; glyph?: string; children?: ReactNode }) {
  return (
    <svg {...S}>
      <path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="var(--fg-muted)" />
      <path d="M9.5 1.5V5H13" fill="none" stroke="var(--fg-muted)" />
      {accent ? <path d="M3.5 13.6h9" stroke={accent} strokeWidth="1.6" /> : null}
      {glyph && accent ? (
        <g transform="translate(0 -1.2)">
          <Glyph type={glyph} color={accent} />
        </g>
      ) : null}
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

// Git files (.gitignore, .gitattributes, ...): the diamond of the Git logo with a branch inside.
function GitFileIcon() {
  return (
    <svg {...S}>
      <path d="M8 1.2l6.8 6.8L8 14.8 1.2 8z" fill="var(--folder-others)" />
      <circle cx="6.2" cy="10" r="1.15" fill="var(--bg)" />
      <circle cx="6.2" cy="5.8" r="1.15" fill="var(--bg)" />
      <circle cx="9.8" cy="7.6" r="1.15" fill="var(--bg)" />
      <path d="M6.2 6.2v3.4M6.2 9.2c0-1.4 1.6-1.6 3.4-1.6" stroke="var(--bg)" strokeWidth="1" fill="none" />
    </svg>
  )
}

function ConfigFileIcon() {
  return (
    <svg {...S}>
      <circle cx="8" cy="8" r="2.4" fill="none" stroke="var(--fg-muted)" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="var(--fg-muted)" strokeWidth="2.2" strokeDasharray="2 1.8" />
    </svg>
  )
}

function fileIcon(label: string) {
  const lower = label.toLowerCase()
  if (lower.startsWith('.git') || lower.endsWith('ignore')) return <GitFileIcon />
  if (lower === '.npmrc' || lower === '.editorconfig' || lower.endsWith('.config.json') || lower.endsWith('.config.mjs') || lower.endsWith('.config.js')) return <ConfigFileIcon />
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
      return <Sheet accent="var(--folder-entity)" glyph="entity" />
    case 'neonContext':
      return <Sheet accent="var(--folder-context)" glyph="context" />
    case 'process':
      return <Sheet accent="var(--folder-process)" glyph="process" />
    case 'system':
      return <Sheet accent="var(--folder-system)" glyph="system" />
    case 'aliasDefinition':
      return <Sheet accent="var(--folder-alias)" glyph="alias" />
    case 'serviceDefinition':
    case 'entityWebservice':
      return <Sheet accent="var(--folder-service)" glyph="service" />
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
