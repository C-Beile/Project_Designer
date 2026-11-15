import { styleConfig } from '../config/styleConfig'
import { ConfiguredIcon } from '../core/icons/Icon'
import type { TreeNode } from '../wire/types'

// Icons des Projektbaums. Name, Stil und Farbe je Objekttyp stehen in app/config/style.toml
// ([icon.<typ>], Grundwerte in [icons.tree]). Nur das Projekt-Zeichen ist eine Marke und bleibt eigen.

const S = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const

/** Objekttyp aus dem Backend zur Id in `style.toml`. */
const OBJECT_TYPE_ID: Record<string, string> = {
  neonView: 'view',
  entity: 'entity',
  neonContext: 'context',
  process: 'process',
  system: 'system',
  aliasDefinition: 'alias',
  serviceDefinition: 'service',
  entityWebservice: 'service',
}

/** Id in `style.toml` (Icon und Farbe `--folder-<id>`) zu einem Objekttyp. */
export const objectTypeId = (objectType: string): string => OBJECT_TYPE_ID[objectType] ?? objectType.toLowerCase()

const hasTypeIcon = (id: string) => id !== 'plain' && Boolean(styleConfig.icons[id]?.name)

function FolderIcon({ type, open }: { type: string; open: boolean }) {
  if (hasTypeIcon(type)) return <ConfiguredIcon id={type} area="tree" fallback="folder" />
  const id = open ? 'folder-open' : 'folder'
  return <ConfiguredIcon id={id} area="tree" fallback={id} />
}

function ProjectIcon() {
  return (
    <svg {...S}>
      <path d="M2 14L8 2l2.6 5.2L7 14z" fill="var(--project-icon-a)" />
      <path d="M8.4 10.5L10.8 7.6 14 14H9.8z" fill="var(--project-icon-b)" />
    </svg>
  )
}

function fileIcon(label: string) {
  const lower = label.toLowerCase()
  const file = (id: string) => <ConfiguredIcon id={id} area="tree" fallback="file-text" />
  if (lower.startsWith('.git') || lower.endsWith('ignore')) return file('file-git')
  if (lower === '.npmrc' || lower === '.editorconfig' || lower.endsWith('.config.json') || lower.endsWith('.config.mjs') || lower.endsWith('.config.js')) return file('file-config')
  if (lower.endsWith('.json')) return file('file-json')
  if (lower.endsWith('.md')) return file('file-md')
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return file('file-yaml')
  if (lower.endsWith('.js')) return file('file-js')
  if (lower.endsWith('.ts')) return file('file-ts')
  return file('file')
}

function objectIcon(objectType: string | null) {
  const id = objectType ? OBJECT_TYPE_ID[objectType] : undefined
  return <ConfiguredIcon id={id ?? 'file'} area="tree" fallback="file-text" />
}

export function NodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  switch (node.kind) {
    case 'project':
    case 'module':
      return <ProjectIcon />
    case 'libraries':
      return <ConfiguredIcon id="libraries" area="tree" fallback="books" />
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
